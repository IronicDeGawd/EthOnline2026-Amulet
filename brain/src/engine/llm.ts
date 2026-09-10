// Nova Lite writes the two lines the pendant shows. It never chooses the action or the
// amount: those arrive as fixed facts and the output is checked to still contain them.
// Anything slow or off-script falls back to a template so the wrist is never blocked.
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { LLM_TIMEOUT_MS, NOVA_MODEL } from "../config.js";
import type { Candidate } from "./rules.js";
import type { Evidence } from "../data/graph/freshness.js";

export interface Explanation { human: string; rationale: string; source: "nova" | "template"; reason?: string }

export const MAX_LINE = 96; // PROP_TEXT_LEN on the pendant, minus the NUL
export const MAX_ADVISORY_LINE = 48; // two lines of the advisory card, no dots

export function templateFor(c: Candidate): Explanation {
  const f = c.facts;
  switch (c.action) {
    case "REPAY_DEBT":
      return {
        human: `Repay ${f.amount} on ${f.market}`,
        rationale: `Health factor ${f.hf} is under ${f.threshold}; repaying ${f.debt} lifts it toward ${f.target}.`,
        source: "template",
      };
    case "ADD_COLLATERAL":
      return {
        human: `Add ${f.amount} collateral on ${f.market}`,
        rationale: `Health factor ${f.hf} slipped under ${f.threshold}; topping up restores ${f.target}.`,
        source: "template",
      };
    case "ADVISORY":
      // "Word number rest": the pendant splits it into label, big figure, unit line.
      // The card shows two lines of 160 px (about 48 chars); the sheet shows the rest.
      return {
        human: `Utilization ${f.to}% on ${f.market}`,
        rationale: `Up ${f.delta} pts in ${f.window} blocks; borrow rate ${f.borrowRate}%.`,
        source: "template",
      };
    case "MOVE_SUPPLY":
      // The pick behind a yield card: found on mainnet, executed on the Sepolia sim.
      return {
        human: `Supply ${f.amount} on ${f.market}`,
        rationale: `${f.best} ${f.asset} ${f.bestRate}% beats ${f.current} ${f.curRate}% by ${f.delta} bps; mainnet data, sim execution.`,
        source: "template",
      };
    case "OPTIONS":
      return {
        human: `Better yield for ${f.asset}`,
        rationale: `${f.best} pays ${f.bestRate}%, ${f.current} ${f.curRate}%: ${f.delta} bps more.`,
        source: "template",
      };
    default:
      return { human: `${c.action} on ${f.market}`, rationale: "Rule fired.", source: "template" };
  }
}

// One row of the options card: what the wrist prints beside the rate.
export function optionLine(protocol: string, market: string): string {
  const short = market.replace(/^(Aave|Compound|Spark)( V\d| Ethereum)?\s*/i, "").split(" - ")[0].trim();
  return `${protocol} ${short}`.slice(0, 24);
}

export function buildPrompt(c: Candidate, ev: Evidence): { system: string; user: string } {
  const facts = Object.entries(c.facts).map(([k, v]) => `${k}: ${v}`).join("\n");
  const verb = templateFor(c).human.split(" ")[0];
  const must = mustKeep(c).join(" and ");
  const example = JSON.stringify({ human: templateFor(c).human, rationale: templateFor(c).rationale });
  return {
    system:
      "You write the two lines a small wearable shows before its owner approves a DeFi action. " +
      "The action and every number are already decided. Copy figures exactly as given; never change, round, add or drop one. " +
      `Both "${must}" must appear verbatim across the two lines. Never print internal names like REPAY_DEBT or HF_LOW. ` +
      "Reply with JSON only, no code fences: {\"human\": string, \"rationale\": string}. " +
      `human <= 60 chars, one line, starts with "${verb}", then the figure, then the market. ` +
      `rationale <= ${c.action === "ADVISORY" ? MAX_ADVISORY_LINE : 90} chars, one plain sentence saying why now, in fresher words than the example but with the same figures. ` +
      `Example for this exact case: ${example}`,
    user:
      `action: ${c.action}\nrule: ${c.rule}\n${facts}\n` +
      `evidence: ${ev.subgraph} deployment ${ev.deploymentId.slice(0, 10)}… block ${ev.block}`,
  };
}

function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// The pendant splits "Verb 0.0062 ETH on Sim-A" into a verb, a big figure and a unit line;
// anything else lands whole on the figure line and is cut. The big figure has room for
// six characters at 52 px.
export const HEADLINE = /^[A-Za-z]+ \d[\d.,]{0,5}%?( \S.*)?$/;

// Accepts the model's text only if the fixed figures survived intact and the headline
// keeps the shape the pendant lays out.
export function acceptOutput(text: string, c: Candidate): Explanation | undefined {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return undefined;
  let j: { human?: unknown; rationale?: unknown };
  try { j = JSON.parse(m[0]); } catch { return undefined; }
  if (typeof j.human !== "string" || typeof j.rationale !== "string") return undefined;
  // Advisories keep the template headline; the model only writes the why.
  const human = c.action === "ADVISORY" ? templateFor(c).human : oneLine(j.human, MAX_LINE);
  if (!HEADLINE.test(human)) return undefined;
  const rationale = oneLine(j.rationale, MAX_LINE);
  if (c.action === "ADVISORY" && rationale.length > MAX_ADVISORY_LINE) return undefined;
  for (const k of mustKeep(c)) {
    if (!human.includes(k) && !rationale.includes(k)) return undefined;
  }
  return { human, rationale, source: "nova" };
}

// The figures that must survive the model untouched, per action.
export function mustKeep(c: Candidate): string[] {
  const keys = c.action === "ADVISORY" ? ["to", "delta"]
    : c.action === "MOVE_SUPPLY" ? ["amount", "bestRate"]
    : ["amount", "hf"];
  return keys.map((k) => c.facts[k]).filter((x): x is string => typeof x === "string");
}

export interface Explainer { explain(c: Candidate, ev: Evidence): Promise<Explanation> }

export function makeNovaExplainer(region: string, timeoutMs = LLM_TIMEOUT_MS): Explainer {
  const client = new BedrockRuntimeClient({ region });
  return {
    async explain(c, ev) {
      const fallback = templateFor(c);
      const { system, user } = buildPrompt(c, ev);
      try {
        const res = await client.send(
          new ConverseCommand({
            modelId: NOVA_MODEL,
            system: [{ text: system }],
            messages: [{ role: "user", content: [{ text: user }] }],
            inferenceConfig: { maxTokens: 160, temperature: 0.3 },
          }),
          { abortSignal: AbortSignal.timeout(timeoutMs) },
        );
        const text = res.output?.message?.content?.map((b) => b.text ?? "").join("") ?? "";
        return acceptOutput(text, c) ?? { ...fallback, reason: `rejected: ${text.replace(/\s+/g, " ").slice(0, 160)}` };
      } catch (e) {
        return { ...fallback, reason: `${(e as Error).name}: ${(e as Error).message.split("\n")[0].slice(0, 160)}` };
      }
    },
  };
}

export const templateExplainer: Explainer = { explain: async (c) => templateFor(c) };
