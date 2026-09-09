// The loop. Once per tick: head block, Graph evidence through the freshness gate, guarded
// position, rules, tier, policy, explanation, unsigned tx, push to the pendant, wait for
// the wrist, record the outcome on AmuletLog. Holds no key that can move funds.
import type { PublicClient } from "viem";
import {
  LEDGER_ADDRESS, PROPOSAL_TTL_S, SUBGRAPHS, TICK_MS, type Deployments, type Policy,
} from "./config.js";
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

    // 1. Evidence, gated.
    const [head, lending] = await Promise.all([headBlock(d.mainnet), fetchLending(d.graph, "aaveV3")]);
    const fresh = checkFreshness("aaveV3", lending.meta, head, lending.queriedAt, undefined, d.simulate?.pinDeployment);
    if (!fresh.ok) {
      d.pendant.setState("stale");
      d.log(`STALE ${fresh.reason}: ${fresh.detail} — standing down`);
      return false;
    }
    d.pendant.setState("watching");
    const weth = pickMarket(lending.markets, "WETH");
    if (weth) this.utilHistory.push({ block: fresh.evidence.block, snap: weth });
    if (this.utilHistory.length > 400) this.utilHistory.shift();

    // 2. Position.
    let pos = await readPosition(d.sepolia, d.dep.simA, this.ledger);
    if (d.simulate?.hf && Number.isFinite(pos.healthFactor)) pos = fakeHf(pos, d.simulate.hf);

    const past = d.simulate?.utilSpike && weth
      ? { ...weth, utilization: Math.max(0, weth.utilization - 0.15) }
      : this.utilHistory.find((s) => s.block <= fresh.evidence.block - d.policy.util_window_blocks)?.snap;
    const market: MarketContext = { current: weth, past };

    d.log(
      `block ${fresh.evidence.block} (lag ${fresh.lag}) ${SUBGRAPHS.aaveV3.name} ${fresh.evidence.deploymentId.slice(0, 12)}… ` +
      `WETH util ${weth ? (weth.utilization * 100).toFixed(1) : "?"}% borrow ${weth ? (weth.borrowRateBps / 100).toFixed(2) : "?"}% | ` +
      `${pos.name} HF ${Number.isFinite(pos.healthFactor) ? pos.healthFactor.toFixed(3) : "∞"} ` +
      `coll ${(Number(pos.collateralWei) / 1e18).toFixed(4)} ETH debt ${(Number(pos.debtUnits) / 1e6).toFixed(2)} sUSDC`,
    );

    // 3. Rules → candidates; one proposal at a time, with a cooldown per rule.
    const candidates = evaluate(pos, market, d.policy).filter((c) => {
      const last = this.lastRuleAt.get(c.rule) ?? 0;
      return Date.now() - last > 60_000;
    });
    if (!candidates.length) return false;
    const c = candidates.sort((a, b) => tierOf(b, d.policy) - tierOf(a, d.policy))[0];
    return this.propose(c, fresh.evidence);
  }

  private async propose(c: Candidate, evidence: Evidence): Promise<boolean> {
    const { d } = this;
    const tier = tierOf(c, d.policy);
    this.lastRuleAt.set(c.rule, Date.now());

    // 4. Unsigned tx.
    let data: `0x${string}` = "0x";
    let to: `0x${string}` = c.sim;
    if (c.action === "REPAY_DEBT") data = repayCalldata();
    else if (c.action === "ADD_COLLATERAL") data = supplyCalldata();
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
    const p = assemble(c.action, tier, text, tx, evidence);
    this.pending = p;
    d.pendant.setState("proposing");
    d.log(`PROPOSE ${p.id} tier ${tier} ${c.rule} → ${c.action}: "${p.human}" / "${p.rationale}" [${text.source}${text.reason ? `; ${text.reason}` : ""}]`);
    if (!d.pendant.push(p)) {
      d.log("pendant not connected; proposal dropped");
      this.pending = undefined;
      d.pendant.setState("watching");
      return false;
    }

    // 8. The wrist decides.
    const decision = await d.pendant.awaitDecision(p.id, PROPOSAL_TTL_S * 1000);
    this.pending = undefined;
    d.pendant.setState("watching");
    d.log(`DECISION ${p.id}: ${decision.result}${decision.txHash ? ` tx ${decision.txHash}` : ""}`);
    await this.record(p, c, decision);
    if (decision.result === "approved" && decision.txHash) {
      try {
        const rcpt = await d.sepolia.waitForTransactionReceipt({ hash: decision.txHash as `0x${string}`, timeout: 120_000 });
        d.log(`mined in block ${rcpt.blockNumber} status ${rcpt.status} https://sepolia.etherscan.io/tx/${decision.txHash}`);
      } catch (e) {
        d.log(`receipt not seen yet: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    return true;
  }

  private async record(p: Proposal, c: Candidate, decision: Decision): Promise<void> {
    const { d } = this;
    if (!d.recorder || c.action === "ADVISORY") return;
    try {
      const h = await d.recorder.record({
        proposalId: proposalIdBytes32(p.id),
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
