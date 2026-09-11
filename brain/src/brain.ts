// The loop. Once per tick: head block, Graph evidence through the freshness gate, guarded
// position, rules, tier, policy, explanation, unsigned tx, push to the pendant, wait for
// the wrist, record the outcome on AmuletLog. Holds no key that can move funds.
import { toHex, type PublicClient } from "viem";
import {
  DEFAULT_COOLDOWN_MS, INTENT_TTL_S, LEDGER_ADDRESS, POLICY_REFRESH_TICKS, PROPOSAL_TTL_S, RULE_COOLDOWN_MS, SUBGRAPHS, TICK_MS,
  YIELD_HOLD_BLOCKS, YIELD_TICKS, type Deployments, type Policy,
} from "./config.js";
import type { YieldRow, YieldTable } from "./data/graph/yield.js";
import { assembleOptions, pickCandidate } from "./engine/options.js";
import { accountNonce, actionName, type Intent, type Relayer } from "./chain/account712.js";
import { CURRENT_VENUE, positionUsd, YIELD_LIQUIDITY_X } from "./engine/rules.js";
import { policyDiff, type PolicyRead } from "./ens/resolver.js";
import type { BrainStatus, StatusWriter } from "./ens/status.js";
import { GraphClient } from "./data/graph/client.js";
import { checkFreshness, type Evidence } from "./data/graph/freshness.js";
import { fetchLending, pickMarket, type MarketSnapshot } from "./data/graph/lending.js";
import { headBlock } from "./chain/sepolia.js";
import { readPosition, type Position } from "./chain/positionsim.js";
import { makeRecorder, type Recorder } from "./chain/amuletlog.js";
import { evaluate, type Candidate, type MarketContext } from "./engine/rules.js";
import { tierOf } from "./engine/tiers.js";
import { selectorOf, withinPolicy } from "./engine/policy.js";
import type { Explainer } from "./engine/llm.js";
import { assemble, proposalIdBytes32, type Proposal } from "./engine/proposal.js";
import { buildTx, repayCalldata, supplyCalldata } from "./tx/builder.js";
import { PendantLink, type Decision } from "./pendant/ws.js";

export interface Simulation {
  hf?: number; // pretend the position sits at this HF (price is scaled in memory)
  utilSpike?: boolean; // pretend utilization jumped since the window start
  pinDeployment?: string; // pretend the pinned deployment is this one (freshness fails)
  yield?: boolean; // pretend Spark pays 250 bps more than Aave for the asset, and skip the hold
}

export interface BrainDeps {
  sepolia: PublicClient;
  mainnet: PublicClient;
  graph: GraphClient;
  explainer: Explainer;
  dep: Deployments;
  policy: Policy;
  pendant: PendantLink;
  recorder?: Recorder;
  policySource?: () => Promise<PolicyRead>; // ENS; re-read every POLICY_REFRESH_TICKS
  status?: StatusWriter; // amulet.status / amulet.last-action on ENS
  mainnetView?: () => Promise<string>; // read-only line about the user's real position
  yieldSource?: () => Promise<YieldTable>; // ranked venues for the position's asset
  relayer?: Relayer; // typed-data path: the wrist signs an intent, this carries it to chain
  agent?: string; // the name this brain runs as; goes into every proposal it sends
  log: (line: string) => void;
  simulate?: Simulation;
  once?: boolean; // stop after the first decision
}

interface UtilSample { block: number; snap: MarketSnapshot }

export class Brain {
  private ledger: `0x${string}` = LEDGER_ADDRESS;
  private utilHistory: UtilSample[] = [];
  private pending?: Proposal;
  private lastRuleAt = new Map<string, number>();
  private stopped = false;
  private ticks = 0;
  private yieldRows?: YieldRow[];
  private yieldSince?: number; // mainnet block since which the spread has held

  // Ranked venues, refreshed every few ticks. Returns the rows only once the spread has held
  // for YIELD_HOLD_BLOCKS (or at once under --simulate yield), so a one-block blip never
  // reaches the wrist.
  private async yieldContext(pos: Position, head: number): Promise<YieldRow[] | undefined> {
    const { d } = this;
    if (!d.yieldSource) return undefined;
    if (!this.yieldRows || this.ticks % YIELD_TICKS === 1) {
      try {
        const t = await d.yieldSource();
        this.yieldRows = t.rows;
        if (t.skipped.length) d.log(`yield: skipped ${t.skipped.join("; ")}`);
      } catch (e) {
        d.log(`yield table failed: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    let rows = this.yieldRows;
    if (!rows || rows.length < 2) return undefined;
    if (d.simulate?.yield) {
      const cur = rows.find((r) => r.protocol === CURRENT_VENUE);
      if (cur) {
        rows = rows.map((r) => (r.protocol === "Spark" ? { ...r, supplyRateBps: cur.supplyRateBps + 250 } : r)).sort((a, b) => b.supplyRateBps - a.supplyRateBps);
        return rows;
      }
    }
    const best = rows[0];
    const cur = rows.find((r) => r.protocol === CURRENT_VENUE);
    const above = !!cur && best.protocol !== CURRENT_VENUE
      && best.supplyRateBps - cur.supplyRateBps > d.policy.yield_delta_bps
      && best.depositUSD > YIELD_LIQUIDITY_X * positionUsd(pos);
    if (!above) { this.yieldSince = undefined; return undefined; }
    this.yieldSince ??= head;
    if (head - this.yieldSince < YIELD_HOLD_BLOCKS) {
      d.log(`yield: ${best.protocol} over ${cur!.protocol} by ${best.supplyRateBps - cur!.supplyRateBps} bps, holding since block ${this.yieldSince} (${head - this.yieldSince}/${YIELD_HOLD_BLOCKS})`);
      return undefined;
    }
    return rows;
  }

  // Pendant and ENS hear the same word.
  private setState(s: BrainStatus): void {
    this.d.pendant.setState(s);
    void this.d.status?.setStatus(s);
  }

  // Policy comes from ENS; a change there shows up here within a couple of minutes and is
  // logged field by field. A failed read keeps the last good policy and says so.
  private async refreshPolicy(): Promise<void> {
    const { d } = this;
    if (!d.policySource) return;
    try {
      const read = await d.policySource();
      const diff = policyDiff(d.policy, read.policy);
      if (diff.length) {
        d.log(`policy from ${read.name} changed: ${diff.join("; ")}`);
        d.policy = read.policy;
        d.pendant.send({ type: "policy" }); // the wrist re-reads the name now, not in an hour
      } else if (this.ticks === 0) {
        d.log(`policy from ${read.name}: v${read.policy.version} chain ${read.policy.chain}, ${read.policy.allowed.length} targets, cap ${Number(read.policy.max_value_wei) / 1e18} ETH, tiers ${read.policy.tier1_hf}/${read.policy.tier2_hf}`);
      }
    } catch (e) {
      d.log(`policy read failed, keeping the last one: ${(e as Error).message.split("\n")[0]}`);
    }
  }

  constructor(private readonly d: BrainDeps) {
    d.pendant.on("presence", (p) => {
      if (p.address && /^0x[0-9a-fA-F]{40}$/.test(p.address) && p.address !== this.ledger) {
        this.ledger = p.address as `0x${string}`;
        d.log(`pendant reports Ledger ${this.ledger}`);
      }
    });
    d.pendant.on("connected", () => d.log("pendant connected"));
    d.pendant.on("disconnected", () => d.log("pendant disconnected"));
  }

  // Whose position the rules watch: the account when it is the one acting, else the Ledger.
  private guarded(): `0x${string}` {
    return this.d.relayer && this.d.dep.amuletAccount ? this.d.dep.amuletAccount : this.ledger;
  }

  stop(): void { this.stopped = true; }

  async run(): Promise<void> {
    while (!this.stopped) {
      const t0 = Date.now();
      try {
        const done = await this.tick();
        if (done && this.d.once) return;
      } catch (e) {
        this.d.log(`tick failed: ${(e as Error).message}`);
      }
      const wait = Math.max(0, TICK_MS - (Date.now() - t0));
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  // Returns true when a proposal reached a decision this tick.
  async tick(): Promise<boolean> {
    const { d } = this;
    if (this.pending) return false;

    // 0. Policy and the read-only mainnet view, every few ticks.
    if (this.ticks % POLICY_REFRESH_TICKS === 0) {
      await this.refreshPolicy();
      if (d.mainnetView) {
        try { d.log(await d.mainnetView()); } catch (e) { d.log(`mainnet view: ${(e as Error).message.split("\n")[0]}`); }
      }
    }
    this.ticks++;

    // 1. Evidence, gated.
    const [head, lending] = await Promise.all([headBlock(d.mainnet), fetchLending(d.graph, "aaveV3")]);
    const fresh = checkFreshness("aaveV3", lending.meta, head, lending.queriedAt, undefined, d.simulate?.pinDeployment);
    if (!fresh.ok) {
      this.setState("stale");
      d.log(`STALE ${fresh.reason}: ${fresh.detail} — standing down`);
      return false;
    }
    this.setState("watching");
    const weth = pickMarket(lending.markets, "WETH");
    if (weth) this.utilHistory.push({ block: fresh.evidence.block, snap: weth });
    if (this.utilHistory.length > 400) this.utilHistory.shift();

    // 2. Position. With typed-data signing on, the position the agent guards is the one the
    // account holds — that is what the Ledger's signature can move.
    let pos = await readPosition(d.sepolia, d.dep.simA, this.guarded());
    if (d.simulate?.hf && Number.isFinite(pos.healthFactor)) pos = fakeHf(pos, d.simulate.hf);

    const past = d.simulate?.utilSpike && weth
      ? { ...weth, utilization: Math.max(0, weth.utilization - 0.15) }
      : this.utilHistory.find((s) => s.block <= fresh.evidence.block - d.policy.util_window_blocks)?.snap;
    const market: MarketContext = { current: weth, past, yield: await this.yieldContext(pos, fresh.evidence.block) };

    d.log(
      `block ${fresh.evidence.block} (lag ${fresh.lag}) ${SUBGRAPHS.aaveV3.name} ${fresh.evidence.deploymentId.slice(0, 12)}… ` +
      `WETH util ${weth ? (weth.utilization * 100).toFixed(1) : "?"}% borrow ${weth ? (weth.borrowRateBps / 100).toFixed(2) : "?"}% | ` +
      `${pos.name} HF ${Number.isFinite(pos.healthFactor) ? pos.healthFactor.toFixed(3) : "∞"} ` +
      `coll ${(Number(pos.collateralWei) / 1e18).toFixed(4)} ETH debt ${(Number(pos.debtUnits) / 1e6).toFixed(2)} sUSDC`,
    );

    // 3. Rules → candidates; one proposal at a time, with a cooldown per rule.
    const candidates = evaluate(pos, market, d.policy).filter((c) => {
      const last = this.lastRuleAt.get(c.rule) ?? 0;
      return Date.now() - last > (RULE_COOLDOWN_MS[c.rule] ?? DEFAULT_COOLDOWN_MS);
    });
    if (!candidates.length) return false;
    const c = candidates.sort((a, b) => tierOf(b, d.policy) - tierOf(a, d.policy))[0];
    return this.propose(c, fresh.evidence);
  }

  private async propose(c: Candidate, evidence: Evidence): Promise<boolean> {
    const { d } = this;
    const tier = tierOf(c, d.policy);
    this.lastRuleAt.set(c.rule, Date.now());
    if (c.action === "OPTIONS") return this.proposeOptions(c, evidence);

    // 4. Unsigned tx.
    let data: `0x${string}` = "0x";
    let to: `0x${string}` = c.sim;
    if (c.action === "REPAY_DEBT") data = repayCalldata();
    else if (c.action === "ADD_COLLATERAL" || c.action === "MOVE_SUPPLY") data = supplyCalldata();
    else if (c.action === "ADVISORY") to = this.ledger; // nothing to sign; tier 0 card only
    const tx = c.action === "ADVISORY"
      ? { to, value: 0n, data, nonce: 0, gas: 21_000, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n }
      : await buildTx(d.sepolia, { to, value: c.valueWei, data, from: this.ledger });

    // 5. Policy. The pendant checks the same things; this is the brain refusing itself.
    const expiresAt = Math.floor(Date.now() / 1000) + PROPOSAL_TTL_S;
    if (c.action !== "ADVISORY") {
      const v = withinPolicy({ chainId: d.dep.chainId, to, value: tx.value, data, gas: tx.gas, expiresAt }, d.policy);
      if (!v.ok) { d.log(`policy_refused ${c.rule}: ${v.reason}`); return false; }
    }

    // 6. Words, 7. proposal, push.
    const text = await d.explainer.explain(c, evidence);
    // Typed data when a relayer and an account exist and the action is one the account knows.
    // The wrist signs the intent, the Ledger shows it in words, and this process relays it.
    let intent: Intent | undefined;
    const kind = actionName(c.action);
    if (d.relayer && d.dep.amuletAccount && kind && c.action !== "ADVISORY") {
      try {
        const n = await accountNonce(d.sepolia, d.dep.amuletAccount);
        intent = {
          summary: text.human, action: kind, market: c.sim,
          amount: toHex(c.valueWei), nonce: toHex(n), deadline: toHex(BigInt(Math.floor(Date.now() / 1000) + INTENT_TTL_S)),
          account: d.dep.amuletAccount,
        };
      } catch (e) {
        d.log(`account nonce unreadable, falling back to a raw transaction: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    const p = assemble(c.action, tier, text, tx, evidence, undefined, intent, d.agent);
    this.pending = p;
    this.setState("proposing");
    d.log(`PROPOSE ${p.id} [${p.agent}] tier ${tier} ${c.rule} → ${c.action}: "${p.human}" / "${p.rationale}" [${text.source}${text.reason ? `; ${text.reason}` : ""}]`);
    if (!d.pendant.push(p)) {
      d.log("pendant not connected; proposal dropped");
      this.pending = undefined;
      this.setState("watching");
      return false;
    }

    // 8. The wrist decides.
    let decision = await d.pendant.awaitDecision(p.id, PROPOSAL_TTL_S * 1000);
    if (decision.result === "expired" && c.action !== "ADVISORY") {
      // The pendant may have signed and lost the link before its answer arrived. The chain
      // is the record: a nonce past the proposal's means the transaction went out.
      try {
        const n = await d.sepolia.getTransactionCount({ address: this.ledger });
        if (n > p.tx.nonce) {
          decision = { type: "decision", id: p.id, result: "approved" };
          d.log(`no answer from the pendant, but the Ledger nonce is ${n} > ${p.tx.nonce}: treating as approved`);
        }
      } catch (e) {
        d.log(`could not check Ledger nonce for expired decision: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    // A signature instead of a hash means the wrist signed an intent: relay it and pay the gas.
    if (decision.result === "approved" && decision.signature && intent && d.relayer) {
      try {
        const hash = await d.relayer.relay(intent, decision.signature);
        d.log(`relayed the signed intent from ${d.relayer.address} → ${hash}`);
        decision = { ...decision, txHash: hash };
      } catch (e) {
        d.log(`relay failed: ${(e as Error).message.split("\n")[0]}`);
        decision = { ...decision, result: "rejected" };
      }
    }
    this.pending = undefined;
    this.setState("watching");
    d.log(`DECISION ${p.id}: ${decision.result}${decision.txHash ? ` tx ${decision.txHash}` : ""}`);
    await this.record(p, c, decision);
    if (decision.result === "approved" && decision.txHash) {
      try {
        const rcpt = await d.sepolia.waitForTransactionReceipt({ hash: decision.txHash as `0x${string}`, timeout: 120_000 });
        d.log(`mined in block ${rcpt.blockNumber} status ${rcpt.status} https://sepolia.etherscan.io/tx/${decision.txHash}`);
        void d.status?.setLastAction(decision.txHash, rcpt.blockNumber);
      } catch (e) {
        d.log(`receipt not seen yet: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    return true;
  }

  // The options card: venues the policy allows, ranked. Nothing is built until the wearer
  // taps a row; then that row becomes an ordinary tier-2 proposal through propose().
  private async proposeOptions(c: Candidate, evidence: Evidence): Promise<boolean> {
    const { d } = this;
    const { card, filtered } = assembleOptions(c, d.dep, d.policy, evidence);
    for (const f of filtered) d.log(`policy_filtered ${f}`);
    if (!card.items.length) { d.log("yield card: no venue left after the policy filter"); return false; }
    this.setState("proposing");
    d.log(`OPTIONS ${card.id} ${card.asset}: ${card.items.map((i) => `${i.human} ${(i.apyBps / 100).toFixed(2)}%`).join(" | ")}`);
    if (!d.pendant.send(card)) {
      d.log("pendant not connected; card dropped");
      this.setState("watching");
      return false;
    }
    const pick = await d.pendant.awaitPick(card.id, PROPOSAL_TTL_S * 1000);
    if (pick.kind !== "pick") {
      d.log(`OPTIONS ${card.id}: ${pick.kind}`);
      this.setState("watching");
      return pick.kind === "dismiss";
    }
    const chosen = pickCandidate(card, pick.idx, c);
    if (!chosen) { d.log(`OPTIONS ${card.id}: pick ${pick.idx} is not a row`); this.setState("watching"); return false; }
    d.log(`OPTIONS ${card.id}: picked ${pick.idx} → ${chosen.facts.best} on ${chosen.simName}`);
    return this.propose(chosen, evidence);
  }

  private async record(p: Proposal, c: Candidate, decision: Decision): Promise<void> {
    const { d } = this;
    if (!d.recorder || c.action === "ADVISORY") return;
    try {
      const h = await d.recorder.record({
        proposalId: proposalIdBytes32(p.id),
        agent: p.agent ?? "",
        target: p.tx.to,
        value: BigInt(p.tx.value),
        selector: selectorOf(p.tx.data),
        tier: p.tier,
        outcome: decision.result,
      });
      d.log(`AmuletLog.record ${decision.result} → ${h}`);
    } catch (e) {
      d.log(`AmuletLog.record failed: ${(e as Error).message.split("\n")[0]}`);
    }
  }
}

// Scales the price in memory so the HF reads as `hf`; every downstream number then follows
// the same arithmetic the contract would apply at that price.
export function fakeHf(pos: Position, hf: number): Position {
  const price = (pos.price * BigInt(Math.round(hf * 1e6))) / BigInt(Math.round(pos.healthFactor * 1e6));
  return { ...pos, price, healthFactor: hf };
}

export { makeRecorder };
