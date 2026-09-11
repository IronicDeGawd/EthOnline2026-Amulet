// The model decides. It is handed the position, the market, the yield table and its own
// policy, and it answers with an action, a market and an amount — or with "do nothing".
//
// Nothing here is trusted. The answer is parsed, every field is checked against the policy
// it was shown, and the figures the pendant displays are recomputed from the amount by the
// same arithmetic the contract uses. A model that hallucinates a market, an action or a
// number that breaks its cap is dropped and the deterministic rules answer instead — and
// even a decision that passes here is checked again on the wrist.
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { parseEther, formatEther } from "viem";
import { LLM_TIMEOUT_MS, NOVA_MODEL, type Policy } from "../config.js";
import type { Position } from "../chain/positionsim.js";
import { debtUnitsToWei, ethToDebtUnits } from "../chain/positionsim.js";
import { CURRENT_VENUE, positionUsd, type Candidate, type MarketContext } from "./rules.js";
import type { Evidence } from "../data/graph/freshness.js";
import { historyLines, type AgentHistory } from "../data/graph/history.js";

export interface Decision {
  act: boolean;
  action?: "REPAY_DEBT" | "ADD_COLLATERAL" | "MOVE_SUPPLY" | "ADVISORY";
  market?: string;     // the sim's name, as shown in the brief
  amountEth?: string;  // decimal ETH, e.g. "0.0062"
  why?: string;        // one sentence, for the log; the pendant's words are written elsewhere
}

export interface Judgement {
  candidate?: Candidate;
  decision?: Decision;
  reason: string;      // why it was taken or dropped — always printed, so the demo is legible
  source: "nova" | "rules";
  attempts?: number;   // 2 when it was told why it was refused and answered again
  firstTry?: string;   // what it said the first time, when a correction happened
}

const ACTIONS = new Set(["REPAY_DEBT", "ADD_COLLATERAL", "MOVE_SUPPLY", "ADVISORY"]);

function fmtEth(wei: bigint): string {
  const s = (Number(wei) / 1e18).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return `${s} ETH`;
}

function fmtUsd(units: bigint): string {
  return `$${(Number(units) / 1e6).toFixed(2)}`;
}

// What the model is allowed to know: its position, the market, its own leash. The caps are
// in the brief on purpose — an agent that cannot see its limits cannot respect them, and we
// want to be able to say the refusals happen despite the model having been told.
export function brief(p: Position, market: MarketContext, policy: Policy, mandate: string, ev?: Evidence, hist?: AgentHistory, lastRefusal?: string): { system: string; user: string } {
  const hf = Number.isFinite(p.healthFactor) ? p.healthFactor.toFixed(3) : "none (no debt)";
  const rows = market.yield ?? [];
  const yields = rows
    .map((r) => `  ${r.protocol} ${r.symbol} ${(r.supplyRateBps / 100).toFixed(2)}% deposits $${(r.depositUSD / 1e6).toFixed(0)}M`)
    .join("\n");
  // A small model should not be asked to do arithmetic it can get wrong: the comparison that
  // decides MOVE_SUPPLY is spelled out, along with the verdict its own policy implies.
  const best = rows[0];
  const here = rows.find((r) => r.protocol === CURRENT_VENUE);
  const spread = best && here ? best.supplyRateBps - here.supplyRateBps : undefined;
  const spreadLine = best && here && spread !== undefined
    ? `best venue ${best.protocol} at ${(best.supplyRateBps / 100).toFixed(2)}% vs your venue ${here.protocol} at ${(here.supplyRateBps / 100).toFixed(2)}%: ` +
      `a difference of ${spread} bps, which is ${spread > policy.yield_delta_bps ? "ABOVE" : "below"} the ${policy.yield_delta_bps} bps your policy asks for\n`
    : "";
  return {
    system:
      `${mandate}\n` +
      "You manage one DeFi position for a human who must approve everything you propose. " +
      "Decide whether to act now. Acting has a cost: every proposal interrupts the human, so propose only when the position or the opportunity justifies it.\n" +
      "Allowed actions:\n" +
      "  REPAY_DEBT — send ETH to repay debt on the position's market. Raises the health factor.\n" +
      "  ADD_COLLATERAL — send ETH as collateral on the position's market. Also raises the health factor.\n" +
      "  MOVE_SUPPLY — supply ETH at a different venue that pays a better rate.\n" +
      "  ADVISORY — tell the human something without proposing a transaction.\n" +
      "Reply with JSON only, no code fences: " +
      '{"act": boolean, "action": string, "market": string, "amountEth": string, "why": string}. ' +
      'When you choose not to act, reply {"act": false, "why": "..."} and nothing else. ' +
      "amountEth is a decimal number of ETH as a string. why is one sentence under 120 characters.",
    user:
      `position: ${p.name}  (this is the only market you may name; the venue you move to is chosen by the ranking, not by you)\n` +
      `  collateral: ${formatEther(p.collateralWei)} ETH\n` +
      `  debt: ${fmtUsd(p.debtUnits)}\n` +
      `  price: $${(Number(p.price) / 1e8).toFixed(2)} per ETH\n` +
      `  liquidation threshold: ${p.ltBps / 100}%\n` +
      `  health factor: ${hf}  (liquidation at 1.00)\n` +
      (market.current
        ? `market ${market.current.protocol} ${market.current.symbol}: utilization ${(market.current.utilization * 100).toFixed(1)}%, ` +
          `supply ${(market.current.supplyRateBps / 100).toFixed(2)}%, borrow ${(market.current.borrowRateBps / 100).toFixed(2)}%\n`
        : "") +
      (yields ? `venues paying for this asset:\n${yields}\n` : "") +
      spreadLine +
      // Spelled out, because a small model reads "no debt" as "nothing to do" otherwise.
      (p.debtUnits === 0n
        ? "this position has no debt, so REPAY_DEBT is not available; MOVE_SUPPLY and ADD_COLLATERAL do not need debt\n"
        : "") +
      `your limits (the wearer's device enforces these; exceeding one gets you refused):\n` +
      `  most you may send in one action: ${formatEther(policy.max_value_wei)} ETH\n` +
      `  markets you may touch: ${p.name}\n` +
      `  act on the health factor below: ${policy.tier2_hf.toFixed(2)}; aim for ${policy.target_hf.toFixed(2)}\n` +
      `  a better rate is worth moving for above: ${policy.yield_delta_bps} bps\n` +
      // Where the numbers came from, in the prompt itself: the model is told which indexed
      // deployment and which block it is reasoning over, so a stale answer is its own fault.
      (ev ? `evidence: ${ev.subgraph} deployment ${ev.deploymentId.slice(0, 12)}… at block ${ev.block}\n` : "") +
      // Its own past, read back from the subgraph that indexed it. An agent that cannot
      // remember being refused will be refused again for the same reason.
      historyLines(hist) +
      // The last thing the wrist said no to, in its own words. This is the difference between
      // an agent that learns and one that asks the same question until its owner stops reading.
      (lastRefusal ? `the last time you asked, it was refused: ${lastRefusal}\n` : ""),
  };
}

export function parseDecision(text: string): Decision | undefined {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return undefined;
  let j: Record<string, unknown>;
  try { j = JSON.parse(m[0]) as Record<string, unknown>; } catch { return undefined; }
  if (typeof j.act !== "boolean") return undefined;
  const d: Decision = { act: j.act };
  if (typeof j.why === "string") d.why = j.why.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!j.act) return d;
  if (typeof j.action === "string") d.action = j.action.toUpperCase().trim() as Decision["action"];
  if (typeof j.market === "string") d.market = j.market.trim();
  if (typeof j.amountEth === "number") d.amountEth = String(j.amountEth);
  if (typeof j.amountEth === "string") d.amountEth = j.amountEth.trim().replace(/[^\d.]/g, "");
  return d;
}

// Turns a decision into a candidate, or says why it cannot. The facts are recomputed here,
// never copied from the model: the number the wearer reads is the number that executes.
export function validate(d: Decision, p: Position, market: MarketContext, policy: Policy): { candidate?: Candidate; reason: string } {
  if (!d.act) return { reason: `stood down: ${d.why ?? "no reason given"}` };
  if (!d.action || !ACTIONS.has(d.action)) return { reason: `unknown action ${d.action ?? "(none)"}` };

  if (d.action === "ADVISORY") {
    return {
      candidate: {
        rule: "UTIL_SPIKE", action: "ADVISORY", sim: p.sim, simName: p.name, valueWei: 0n,
        facts: {
          market: market.current ? `${market.current.protocol} ${market.current.symbol}` : p.name,
          to: market.current ? (market.current.utilization * 100).toFixed(1) : "0",
          from: market.past ? (market.past.utilization * 100).toFixed(1) : "0",
          delta: market.current && market.past ? ((market.current.utilization - market.past.utilization) * 100).toFixed(1) : "0",
          borrowRate: market.current ? (market.current.borrowRateBps / 100).toFixed(2) : "0",
          window: policy.util_window_blocks,
        },
      },
      reason: "advisory",
    };
  }

  // The contract it may touch is never taken from the model — it is always this agent's own
  // market. The name is checked only to catch a model that thinks it is somewhere else. For a
  // move, naming the venue it wants to move to (Spark, Compound) is the natural answer, so
  // that is allowed too; the execution still happens on the agent's own market.
  const venues = (market.yield ?? []).map((r) => r.protocol.toLowerCase());
  const named = d.market?.toLowerCase() ?? "";
  const naming_ok = !named
    || named === p.name.toLowerCase()
    || (d.action === "MOVE_SUPPLY" && venues.some((v) => named.startsWith(v)));
  if (!naming_ok) return { reason: `market "${d.market}" is not one it may touch (${p.name})` };

  let wei: bigint;
  try { wei = parseEther((d.amountEth ?? "").length ? (d.amountEth as string) : "0"); }
  catch { return { reason: `amount "${d.amountEth}" is not a number` }; }
  if (wei <= 0n) return { reason: "amount is zero" };
  if (wei > policy.max_value_wei) {
    return { reason: `${fmtEth(wei)} is over its own cap of ${fmtEth(policy.max_value_wei)}` };
  }

  const hf = Number.isFinite(p.healthFactor) ? p.healthFactor.toFixed(2) : "0";
  if (d.action === "REPAY_DEBT") {
    if (p.debtUnits === 0n) return { reason: "asked to repay a debt that does not exist" };
    let units = ethToDebtUnits(wei, p.price);
    if (units > p.debtUnits) units = p.debtUnits;
    if (units === 0n) return { reason: "amount is too small to repay anything" };
    const valueWei = debtUnitsToWei(units, p.price) + 1n;
    return {
      candidate: {
        rule: "HF_LOW", action: "REPAY_DEBT", sim: p.sim, simName: p.name, valueWei, debtUnits: units,
        facts: {
          hf, threshold: policy.tier2_hf.toFixed(2), target: policy.target_hf.toFixed(2),
          amount: fmtEth(valueWei), debt: fmtUsd(units), market: p.name,
        },
      },
      reason: `repay ${fmtUsd(units)}`,
    };
  }

  if (d.action === "ADD_COLLATERAL") {
    return {
      candidate: {
        rule: "HF_WARN", action: "ADD_COLLATERAL", sim: p.sim, simName: p.name, valueWei: wei,
        facts: {
          hf, threshold: policy.tier1_hf.toFixed(2), target: policy.target_hf.toFixed(2),
          amount: fmtEth(wei), market: p.name,
        },
      },
      reason: `add ${fmtEth(wei)}`,
    };
  }

  // MOVE_SUPPLY: only to a venue the yield table actually ranked above the current one.
  const rows = market.yield ?? [];
  const best = rows[0];
  const current = rows.find((r) => r.protocol === CURRENT_VENUE);
  if (!best || !current) return { reason: "no yield table to move against" };
  if (best.protocol === CURRENT_VENUE) return { reason: "the current venue already pays the most" };
  if (best.depositUSD < 10 * positionUsd(p)) return { reason: `${best.protocol} is too thin to hold this position` };
  const delta = best.supplyRateBps - current.supplyRateBps;
  if (delta <= policy.yield_delta_bps) {
    return { reason: `${delta} bps is under the ${policy.yield_delta_bps} bps its policy asks for` };
  }
  return {
    candidate: {
      rule: "YIELD_OPP", action: "MOVE_SUPPLY", sim: p.sim, simName: p.name, valueWei: wei,
      facts: {
        amount: fmtEth(wei), market: p.name, asset: best.symbol, best: best.protocol,
        bestRate: (best.supplyRateBps / 100).toFixed(2), current: current.protocol,
        curRate: (current.supplyRateBps / 100).toFixed(2), delta,
      },
    },
    reason: `move ${fmtEth(wei)} to ${best.protocol}`,
  };
}

export interface Decider {
  decide(p: Position, market: MarketContext, policy: Policy, mandate: string, ev?: Evidence, hist?: AgentHistory, lastRefusal?: string): Promise<Judgement>;
}

// Reasons worth a second attempt: the model wanted something reasonable and got the shape or
// the size wrong. "Stood down", "no yield table" and the like are not mistakes to correct.
export function correctable(reason: string): boolean {
  return /over its own cap|not one it may touch|unknown action|is not a number|amount is zero|too small/.test(reason);
}

export function makeNovaDecider(region: string, timeoutMs = LLM_TIMEOUT_MS): Decider {
  const client = new BedrockRuntimeClient({ region });
  return {
    async decide(p, market, policy, mandate, ev, hist, lastRefusal) {
      const { system, user } = brief(p, market, policy, mandate, ev, hist, lastRefusal);
      const ask = async (messages: { role: "user" | "assistant"; content: { text: string }[] }[]) => {
        const res = await client.send(
          new ConverseCommand({
            modelId: NOVA_MODEL,
            system: [{ text: system }],
            messages,
            inferenceConfig: { maxTokens: 220, temperature: 0.2 },
          }),
          { abortSignal: AbortSignal.timeout(timeoutMs) },
        );
        return res.output?.message?.content?.map((b) => b.text ?? "").join("") ?? "";
      };
      try {
        const messages: { role: "user" | "assistant"; content: { text: string }[] }[] = [
          { role: "user", content: [{ text: user }] },
        ];
        const text = await ask(messages);
        const d = parseDecision(text);
        if (!d) return { reason: `unreadable answer: ${text.replace(/\s+/g, " ").slice(0, 140)}`, source: "rules" };
        const v = validate(d, p, market, policy);
        if (v.candidate || !correctable(v.reason)) {
          return { candidate: v.candidate, decision: d, reason: v.reason, source: v.candidate ? "nova" : "rules", attempts: 1 };
        }

        // It asked for something it is not allowed. Tell it exactly why and let it answer once
        // more. One retry only: an agent that argues with its own limits is worse than silence.
        messages.push({ role: "assistant", content: [{ text }] });
        messages.push({
          role: "user",
          content: [{
            text:
              `That was refused: ${v.reason}. ` +
              "Your limits are not negotiable and will not change. " +
              "Answer once more with something inside them, or stand down.",
          }],
        });
        const text2 = await ask(messages);
        const d2 = parseDecision(text2);
        if (!d2) {
          return { decision: d, reason: `${v.reason}; its second answer was unreadable`, source: "rules", attempts: 2, firstTry: v.reason };
        }
        const v2 = validate(d2, p, market, policy);
        return {
          candidate: v2.candidate,
          decision: d2,
          reason: v2.candidate ? `${v2.reason} (after being refused: ${v.reason})` : `${v2.reason}; still refused after being told: ${v.reason}`,
          source: v2.candidate ? "nova" : "rules",
          attempts: 2,
          firstTry: v.reason,
        };
      } catch (e) {
        return { reason: `${(e as Error).name}: ${(e as Error).message.split("\n")[0].slice(0, 140)}`, source: "rules" };
      }
    },
  };
}
