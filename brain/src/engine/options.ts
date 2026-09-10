// The options card: up to three venues for the same asset, ranked, each mapped to the
// Sepolia sim that stands in for it and filtered by the ENS policy — a venue the Ledger
// never allowed is not even shown. A tap on the wrist turns one row into a normal tier-2
// proposal; nothing is built before that.
import { toHex } from "viem";
import { ulid } from "ulid";
import { PROPOSAL_TTL_S, type Deployments, type Policy } from "../config.js";
import type { Evidence } from "../data/graph/freshness.js";
import type { YieldRow } from "../data/graph/yield.js";
import { CURRENT_VENUE, type Candidate } from "./rules.js";
import { optionLine } from "./llm.js";

export const MAX_OPTIONS = 3;
export const MOVE_WEI = 10_000_000_000_000_000n; // 0.01 ETH: a slice, not the position
export const OPTIONS_FOOTER = "mainnet data, sim run"; // ASCII only: the font has no middle dot

export interface OptionItem {
  idx: number;
  protocol: string;
  market: string;
  apyBps: number;
  human: string; // "Spark WETH" — the row text beside the rate
  sim: `0x${string}`;
  simName: string;
  valueWei: `0x${string}`;
}

export interface OptionsCard {
  type: "options";
  id: string;
  kind: "yield";
  asset: string;
  items: OptionItem[];
  footer: string;
  evidence: Evidence;
  expiresAt: number;
}

// Which Sepolia sim plays which mainnet venue.
export function simFor(protocol: string, dep: Deployments): { sim: `0x${string}`; simName: string } {
  return protocol === CURRENT_VENUE ? { sim: dep.simA, simName: "Sim-A" } : { sim: dep.simB, simName: "Sim-B" };
}

function allowsSupply(policy: Policy, sim: `0x${string}`, dep: Deployments): boolean {
  const e = policy.allowed.find((a) => a.target.toLowerCase() === sim.toLowerCase());
  return !!e && e.selectors.map((s) => s.toLowerCase()).includes(dep.selectors.supply.toLowerCase());
}

export interface Assembled { card: OptionsCard; filtered: string[] }

export function assembleOptions(c: Candidate, dep: Deployments, policy: Policy, evidence: Evidence, now = Math.floor(Date.now() / 1000)): Assembled {
  const rows = c.options ?? [];
  const value = policy.max_value_wei < MOVE_WEI ? policy.max_value_wei : MOVE_WEI;
  const filtered: string[] = [];
  const items: OptionItem[] = [];
  for (const r of rows) {
    const { sim, simName } = simFor(r.protocol, dep);
    if (!allowsSupply(policy, sim, dep)) { filtered.push(`${r.protocol} (${simName} not in amulet.allowed)`); continue; }
    if (items.length === MAX_OPTIONS) break;
    items.push({
      idx: items.length, protocol: r.protocol, market: r.market, apyBps: r.supplyRateBps,
      human: optionLine(r.protocol, r.market), sim, simName, valueWei: toHex(value),
    });
  }
  return {
    card: { type: "options", id: ulid(), kind: "yield", asset: String(c.facts.asset), items, footer: OPTIONS_FOOTER, evidence, expiresAt: now + PROPOSAL_TTL_S },
    filtered,
  };
}

// The tapped row as a candidate for the normal propose path.
export function pickCandidate(card: OptionsCard, idx: number, c: Candidate): Candidate | undefined {
  const it = card.items.find((i) => i.idx === idx);
  if (!it) return undefined;
  const wei = BigInt(it.valueWei);
  const amount = `${(Number(wei) / 1e18).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")} ETH`;
  return {
    rule: "YIELD_OPP", action: "MOVE_SUPPLY", sim: it.sim, simName: it.simName, valueWei: wei,
    facts: {
      amount, market: it.simName, asset: card.asset, best: it.protocol, bestRate: (it.apyBps / 100).toFixed(2),
      current: String(c.facts.current), curRate: String(c.facts.curRate), delta: it.apyBps - Math.round(Number(c.facts.curRate) * 100),
    },
  };
}
