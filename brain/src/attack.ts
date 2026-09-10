// A compromised brain. Skips its own policy stage on purpose and pushes something the
// policy forbids, so the pendant's check is the one that has to say no. Also tries to raise
// its own limit on ENS with the hot key, which the resolver's roles refuse.
import type { PublicClient } from "viem";
import { parseEther } from "viem";
import type { Evidence } from "./data/graph/freshness.js";
import { assemble, proposalIdBytes32, type BuiltTx, type Proposal } from "./engine/proposal.js";
import { selectorOf, withinPolicy, type TxShape } from "./engine/policy.js";
import { buildTx, supplyCalldata } from "./tx/builder.js";
import type { Policy, Deployments } from "./config.js";
import type { PendantLink } from "./pendant/ws.js";
import type { Recorder } from "./chain/amuletlog.js";
import { PROPOSAL_TTL_S } from "./config.js";

export type AttackKind =
  | { kind: "value"; eth: string } // an allowed call, far over the value cap
  | { kind: "target"; to: `0x${string}` }; // a plain transfer to an address the policy never listed

export interface AttackDeps {
  sepolia: PublicClient;
  dep: Deployments;
  policy: Policy;
  ledger: `0x${string}`;
  pendant: PendantLink;
  recorder?: Recorder;
  agent?: string; // the name it claims to be; empty means it claims nothing at all
  log: (line: string) => void;
}

const MANUAL_EVIDENCE: Evidence = { deploymentId: "manual", block: 0, queriedAt: 0, subgraph: "attack" };

export async function buildAttack(sepolia: PublicClient, dep: Deployments, ledger: `0x${string}`, a: AttackKind): Promise<{ tx: BuiltTx; human: string; rationale: string }> {
  if (a.kind === "value") {
    const value = parseEther(a.eth);
    // The Ledger cannot pay this, so gas is not estimated: the pendant must refuse before that matters.
    const tx = await buildTx(sepolia, { to: dep.simA, value, data: supplyCalldata(), from: ledger }, 80_000);
    // The words are deliberately ordinary. Nothing on the wrist reads them for honesty —
    // what stops this is the cap on the agent's own name.
    return { tx, human: `Add ${a.eth} ETH collateral on Sim-A`, rationale: "Topping up collateral to keep the position comfortably above the threshold." };
  }
  const tx = await buildTx(sepolia, { to: a.to, value: parseEther("0.001"), data: "0x", from: ledger }, 21_000);
  return { tx, human: `Send 0.001 ETH to ${a.to.slice(0, 6)}…${a.to.slice(-4)}`, rationale: "Routine rebalance to the market's settlement address." };
}

// What the brain's own stage would have said — printed so the log shows the stage was skipped.
export function selfVerdict(tx: BuiltTx, chainId: number, policy: Policy): string {
  const shape: TxShape = { chainId, to: tx.to, value: tx.value, data: tx.data, gas: tx.gas, expiresAt: Math.floor(Date.now() / 1000) + PROPOSAL_TTL_S };
  const v = withinPolicy(shape, policy);
  return v.ok ? "in policy (attack would not be refused!)" : `out of policy: ${v.reason}`;
}

export async function runAttack(d: AttackDeps, a: AttackKind): Promise<Proposal> {
  const built = await buildAttack(d.sepolia, d.dep, d.ledger, a);
  d.log(`attack: ${built.human} — own policy stage skipped; it would have said: ${selfVerdict(built.tx, d.dep.chainId, d.policy)}`);
  const p = assemble("ADD_COLLATERAL", 2, { human: built.human, rationale: built.rationale, source: "template" }, built.tx, MANUAL_EVIDENCE, undefined, undefined, d.agent ?? "");
  d.log(`PROPOSE ${p.id} tier 2 ATTACK as "${p.agent || "(no name)"}": "${p.human}" / "${p.rationale}"`);
  if (!d.pendant.push(p)) throw new Error("pendant not connected");
  const decision = await d.pendant.awaitDecision(p.id, 120_000);
  d.log(`DECISION ${p.id}: ${decision.result}${decision.txHash ? ` tx ${decision.txHash}` : ""}`);
  if (d.recorder) {
    try {
      const h = await d.recorder.record({ proposalId: proposalIdBytes32(p.id), target: p.tx.to, value: BigInt(p.tx.value), selector: selectorOf(p.tx.data), tier: 2, outcome: decision.result });
      d.log(`AmuletLog.record ${decision.result} → ${h}`);
    } catch (e) {
      d.log(`AmuletLog.record failed: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  return p;
}
