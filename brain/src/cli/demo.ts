// A demo driver. One websocket stays open the whole time, so the pendant never has to
// reconnect between scenarios and each one starts the moment you press a key.
import { parseEther, toHex, type Hex, type PublicClient } from "viem";
import { ulid } from "ulid";
import { AGENTS, agentName, type AgentKey, type Deployments, type Policy } from "../config.js";
import { PendantLink } from "../pendant/ws.js";
import { accountNonce, makeRelayer, type Relayer } from "../chain/account712.js";
import { assembleOptions, pickCandidate } from "../engine/options.js";
import { readRecords } from "../ens/resolver.js";
import type { Candidate } from "../engine/rules.js";
import type { YieldRow } from "../data/graph/yield.js";

export interface DemoDeps {
  sepolia: PublicClient;
  dep: Deployments;
  policy: Policy;
  pendant: PendantLink;
  relayer: Relayer;
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
  if (decision.result === "approved" && decision.signature) {
    const hash = await d.relayer.relay(intent as never, decision.signature);
    const r = await d.sepolia.waitForTransactionReceipt({ hash });
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
