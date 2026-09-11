// A demo driver. One websocket stays open the whole time, so the pendant never has to
// reconnect between scenarios and each one starts the moment you press a key.
import { parseEther, toHex, type Hex, type PublicClient } from "viem";
import { ulid } from "ulid";
import { AGENTS, agentName, RECEIPT_TIMEOUT_MS, type AgentKey, type Deployments, type Policy } from "../config.js";
import { PendantLink } from "../pendant/ws.js";
import { accountNonce, makeRelayer, type Relayer } from "../chain/account712.js";
import { proposalIdBytes32 } from "../engine/proposal.js";
import type { Recorder } from "../chain/amuletlog.js";
import { assembleOptions, pickCandidate } from "../engine/options.js";
import { withinPolicy } from "../engine/policy.js";
import { readRecords } from "../ens/resolver.js";
import type { Candidate } from "../engine/rules.js";
import type { YieldRow } from "../data/graph/yield.js";
import { actionName } from "../chain/account712.js";
import type { Judgement } from "../engine/decide.js";

export interface DemoDeps {
  sepolia: PublicClient;
  dep: Deployments;
  policy: Policy;
  pendant: PendantLink;
  relayer: Relayer;
  recorder?: Recorder;
  askModel?: (agent: AgentKey) => Promise<Judgement>;
  syncPrice?: () => Promise<void>;
  ledger: `0x${string}`;
  setPrice: (p: bigint) => Promise<void>;
  setRecord: (name: string, key: string, value: string) => Promise<void>;
  brainWrite: (name: string, key: string, value: string) => Promise<void>;
  log: (l: string) => void;
}

const EVIDENCE = { deploymentId: "manual", block: 0, queriedAt: 0, subgraph: "demo" };
// Nothing that needs the wrist should be started with the wrist away: the scenario would
// simply sit there for its whole timeout with no way to tell why.
function wrist(d: DemoDeps): void {
  if (!d.pendant.connected) throw new Error("the pendant is away — wait for \"pendant connected\"");
}
const sim = (d: Deployments, s: string) => (s === "simB" ? d.simB : d.simA);
const simName = (s: string) => (s === "simB" ? "Sim-B" : "Sim-A");

// Every scenario lands in the on-chain log, refusals included — that history is what the
// subgraph indexes, so what you demo is what a judge can query afterwards.
async function note(d: DemoDeps, id: string, agent: string, market: `0x${string}`, amount: bigint, outcome: string): Promise<void> {
  if (!d.recorder) return;
  try {
    const h = await d.recorder.record({
      proposalId: proposalIdBytes32(id), agent, target: market, value: amount,
      selector: d.dep.selectors.supply, tier: 2, outcome: outcome as never,
    });
    d.log(`  logged on chain: ${h}`);
  } catch (e) {
    d.log(`  could not log it: ${(e as Error).message.split("\n")[0]}`);
  }
}

// A request the wrist should accept: the agent's own market, its own call, inside its cap.
// Signed as typed data, so the Ledger shows the sentence rather than bytes.
async function goodRequest(d: DemoDeps, agent: AgentKey, eth: string, which: string): Promise<void> {
  const account = d.dep.amuletAccount!;
  const market = sim(d.dep, which);
  const amount = parseEther(eth);
  const summary = `Supply ${eth} ETH on ${simName(which)}`;
  const intent = {
    summary, action: "Supply" as const, market,
    amount: toHex(amount), nonce: toHex(await accountNonce(d.sepolia, account)),
    deadline: toHex(BigInt(Math.floor(Date.now() / 1000) + 900)), account,
  };
  const id = ulid();
  wrist(d);
  d.log(`${AGENTS[agent].title} asks: ${summary}`);
  d.pendant.send({
    type: "proposal", id, agent: AGENTS[agent].label, tier: 2, action: "MOVE_SUPPLY",
    human: summary, rationale: "Health factor is comfortable; this keeps it there.",
    tx: { chainId: d.dep.chainId, to: market, value: toHex(amount), data: d.dep.selectors.supply,
          nonce: 0, maxFeePerGas: toHex(0n), maxPriorityFeePerGas: toHex(0n), gas: 90_000 },
    evidence: EVIDENCE, expiresAt: Math.floor(Date.now() / 1000) + 600, intent,
  });
  const decision = await d.pendant.awaitDecision(id, 300_000);
  d.log(`  the wrist said: ${decision.result}`);
  await note(d, id, AGENTS[agent].label, market, amount, decision.result);
  if (decision.result === "approved" && decision.signature) {
    const hash = await d.relayer.relay(intent as never, decision.signature);
    const r = await d.sepolia.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    d.log(`  relayed and mined in block ${r.blockNumber}: https://sepolia.etherscan.io/tx/${hash}`);
  }
}

// A request the wrist should refuse. The words are ordinary on purpose: nothing reads them.
async function badRequest(d: DemoDeps, agent: string, eth: string, which: string, why: string): Promise<void> {
  const market = sim(d.dep, which);
  const amount = parseEther(eth);
  const id = ulid();
  wrist(d);
  d.log(`${agent || "an unnamed agent"} asks: Add ${eth} ETH collateral on ${simName(which)}  (${why})`);
  d.pendant.send({
    type: "proposal", id, agent, tier: 2, action: "ADD_COLLATERAL",
    human: `Add ${eth} ETH collateral on ${simName(which)}`,
    rationale: "Topping up collateral to keep the position comfortably above the threshold.",
    tx: { chainId: d.dep.chainId, to: market, value: toHex(amount), data: d.dep.selectors.supply,
          nonce: 0, maxFeePerGas: toHex(0n), maxPriorityFeePerGas: toHex(0n), gas: 90_000 },
    evidence: EVIDENCE, expiresAt: Math.floor(Date.now() / 1000) + 600,
  });
  const decision = await d.pendant.awaitDecision(id, 120_000);
  d.log(`  the wrist said: ${decision.result}`);
  await note(d, id, agent, market, amount, decision.result);
}

// The yield card: three venues, tap one, and the pick becomes a normal request to sign.
async function yieldCard(d: DemoDeps): Promise<void> {
  const rows: YieldRow[] = [
    { protocol: "Spark", market: "Spark WETH", symbol: "WETH", supplyRateBps: 397, depositUSD: 1.3e9, evidence: EVIDENCE },
    { protocol: "Aave", market: "Aave WETH", symbol: "WETH", supplyRateBps: 147, depositUSD: 5.2e9, evidence: EVIDENCE },
    { protocol: "Compound", market: "Compound WETH", symbol: "WETH", supplyRateBps: 135, depositUSD: 1.2e8, evidence: EVIDENCE },
  ];
  const c: Candidate = {
    rule: "YIELD_OPP", action: "OPTIONS", sim: d.dep.simA, simName: "Sim-A", valueWei: 0n, options: rows,
    facts: { asset: "WETH", best: "Spark", bestRate: "3.97", current: "Aave", curRate: "1.47", delta: 250 },
  };
  wrist(d);
  const { card } = assembleOptions(c, d.dep, d.policy, EVIDENCE);
  d.log(`card: ${card.items.map((i) => `${i.human} ${(i.apyBps / 100).toFixed(2)}%`).join(" | ")}`);
  d.pendant.send(card);
  const pick = await d.pendant.awaitPick(card.id, 300_000);
  if (pick.kind !== "pick") { d.log(`  the wrist said: ${pick.kind}`); return; }
  const chosen = pickCandidate(card, pick.idx, c)!;
  d.log(`  picked ${chosen.facts.best}; sending it as a request to sign`);
  await goodRequest(d, "yield", "0.002", chosen.simName === "Sim-B" ? "simB" : "simA");
}

// Nova decides for real, here, now. Whatever it answers is checked against that agent's
// policy; if it survives, it goes to the wrist exactly like any other request.
async function modelDecides(d: DemoDeps, agent: AgentKey): Promise<void> {
  if (!d.askModel) { d.log("no model wired into this run"); return; }
  d.log(`asking ${AGENTS[agent].title} what it would do…`);
  const j = await d.askModel(agent);
  d.log(`  it said: ${JSON.stringify(j.decision ?? null)}`);
  d.log(`  verdict: ${j.reason}`);
  if (!j.candidate) { d.log("  nothing reaches the wrist"); return; }
  const c = j.candidate;
  const act = actionName(c.action);
  if (!act) { d.log(`  ${c.action} has nothing to sign`); return; }
  // The same second check the running brain applies: chain, target, function, value, gas and
  // expiry. The demo must not be a softer path to the wrist than the real one.
  const expiresAt = Math.floor(Date.now() / 1000) + 600;
  const pv = withinPolicy(
    { chainId: d.dep.chainId, to: c.sim, value: c.valueWei, data: d.dep.selectors.supply, gas: 90_000, expiresAt },
    d.policy,
  );
  if (!pv.ok) { d.log(`  policy refused it here, before the wrist: ${pv.reason}`); return; }
  wrist(d);
  const account = d.dep.amuletAccount!;
  const summary = `${act} ${String(c.facts.amount ?? "")} on ${c.simName}`.replace(/\s+/g, " ");
  const intent = {
    summary, action: act, market: c.sim, amount: toHex(c.valueWei),
    nonce: toHex(await accountNonce(d.sepolia, account)),
    deadline: toHex(BigInt(Math.floor(Date.now() / 1000) + 900)), account,
  };
  const id = ulid();
  d.pendant.send({
    type: "proposal", id, agent: AGENTS[agent].label, tier: 2, action: c.action,
    human: summary, rationale: j.decision?.why ?? "The model chose this.",
    tx: { chainId: d.dep.chainId, to: c.sim, value: toHex(c.valueWei), data: d.dep.selectors.supply,
          nonce: 0, maxFeePerGas: toHex(0n), maxPriorityFeePerGas: toHex(0n), gas: 90_000 },
    evidence: EVIDENCE, expiresAt, intent,
  });
  const decision = await d.pendant.awaitDecision(id, 300_000);
  d.log(`  the wrist said: ${decision.result}`);
  await note(d, id, AGENTS[agent].label, c.sim, c.valueWei, decision.result);
  if (decision.result === "approved" && decision.signature) {
    const hash = await d.relayer.relay(intent as never, decision.signature);
    const r = await d.sepolia.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    d.log(`  relayed and mined in block ${r.blockNumber}: https://sepolia.etherscan.io/tx/${hash}`);
  }
}

export const MENU = `
  1  a request from the repay bot        typed data, sign it on the Nano X
  2  a request from the yield scout      the other face, the other market
  3  yield card                          three venues, tap one, then sign
  4  the yield scout asks for 0.02 ETH   twice its own cap: refused
  5  the repay bot asks for 0.02 ETH     inside its cap: allowed
  6  a request with no agent name        refused outright
  7  a request from a name we never set  refused outright
  8  the agent tries to raise its cap    the resolver refuses it
  9  the Ledger lowers repay's cap       to 0.02 ETH; press 5 after it
  0  put repay's cap back                0.05 ETH again
  d  let the repay bot decide            Nova chooses; the policy checks it
  y  let the yield scout decide          its own mandate, its own cap
  o  take the real ETH price             from Chainlink, into both sims
  p  drop the Sim-A price                $1100: the health factor falls
  r  put the Sim-A price back            $1600: healthy again
  s  status                              caps, balance, nonce, pendant
  m  show this menu again
  q  quit
`;

export async function runScenario(k: string, d: DemoDeps): Promise<void> {
  const repayName = agentName(AGENTS.repay.label);
  switch (k) {
    case "1": return goodRequest(d, "repay", "0.002", "simA");
    case "2": return goodRequest(d, "yield", "0.002", "simB");
    case "3": return yieldCard(d);
    case "4": return badRequest(d, "yield", "0.02", "simB", "yield's cap is 0.01");
    case "5": return badRequest(d, "repay", "0.02", "simA", "repay's cap is 0.05");
    case "6": return badRequest(d, "", "0.001", "simA", "no name");
    case "7": return badRequest(d, "ghost", "0.001", "simA", "a name the wrist never read");
    case "8": {
      d.log("the agent's own key tries to raise the cap on its name");
      try {
        await d.brainWrite(repayName, "amulet.max_value_wei", "5000000000000000000");
        d.log("  IT WENT THROUGH — the roles are wrong");
      } catch (e) {
        d.log(`  refused: ${(e as Error).message.split("\n").slice(0, 2).join(" ").slice(0, 160)}`);
      }
      return;
    }
    case "9":
      d.log("the Ledger's role lowers repay's cap to 0.02 ETH");
      await d.setRecord(repayName, "amulet.max_value_wei", "20000000000000000");
      d.log("  written; the pendant re-reads on its next refresh, the brain within a couple of minutes");
      return;
    case "0":
      d.log("putting repay's cap back to 0.05 ETH");
      await d.setRecord(repayName, "amulet.max_value_wei", "50000000000000000");
      return;
    case "d": return modelDecides(d, "repay");
    case "y": return modelDecides(d, "yield");
    case "o":
      if (!d.syncPrice) { d.log("no oracle wired into this run"); return; }
      return d.syncPrice();
    case "p":
      d.log("dropping the Sim-A price to $1100");
      await d.setPrice(110_000_000_000n);
      return;
    case "r":
      d.log("putting the Sim-A price back to $1600");
      await d.setPrice(160_000_000_000n);
      return;
    case "s": {
      const caps = await Promise.all(Object.values(AGENTS).map(async (a) => {
        const r = await readRecords(d.sepolia, ["amulet.max_value_wei"], agentName(a.label));
        return `${a.label} ${Number(r["amulet.max_value_wei"] ?? 0) / 1e18} ETH`;
      }));
      const [bal, n] = await Promise.all([
        d.sepolia.getBalance({ address: d.dep.amuletAccount! }),
        accountNonce(d.sepolia, d.dep.amuletAccount!),
      ]);
      d.log(`caps: ${caps.join(", ")} | account ${Number(bal) / 1e18} ETH, nonce ${n} | pendant ${d.pendant.connected ? "connected" : "away"}`);
      return;
    }
    default: return;
  }
}

export { makeRelayer };
