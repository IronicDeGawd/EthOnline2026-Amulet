// The yield rule and the options card: when the card fires, what it lists, what a tap
// turns into. The card's JSON is exported for the firmware parser test.
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_POLICY, loadDeployments } from "../src/config.js";
import { defaultPolicy, withinPolicy } from "../src/engine/policy.js";
import { evaluate, type MarketContext } from "../src/engine/rules.js";
import { tierOf } from "../src/engine/tiers.js";
import { assembleOptions, MAX_OPTIONS, MOVE_WEI, pickCandidate } from "../src/engine/options.js";
import { templateFor } from "../src/engine/llm.js";
import type { YieldRow } from "../src/data/graph/yield.js";
import type { Position } from "../src/chain/positionsim.js";

const dep = loadDeployments();
const policy = defaultPolicy(dep);
const ev = { deploymentId: "QmTVumjhubXWP8MeDx5g114MRX99E4Gie5mFqVurttF99X", block: 25945312, queriedAt: 1_800_000_000, subgraph: "Spark Lend Ethereum" };
const row = (protocol: string, bps: number, depositUSD = 1e9): YieldRow => ({ protocol, market: `${protocol} WETH`, symbol: "WETH", supplyRateBps: bps, depositUSD, evidence: ev });

// 0.05 ETH at $1,100: an $55 position.
const pos: Position = {
  sim: dep.simA, name: "Sim-A", collateralWei: 50_000_000_000_000_000n, debtUnits: 36_000_000n, price: 110_000_000_000n, ltBps: 8000, healthFactor: 1.78,
};

describe("YIELD_OPP rule", () => {
  it("fires when another venue beats the current one by more than the threshold", () => {
    const market: MarketContext = { yield: [row("Spark", 397), row("Aave", 147), row("Compound", 135)] };
    const c = evaluate(pos, market, policy).find((x) => x.rule === "YIELD_OPP");
    expect(c).toBeDefined();
    expect(c!.action).toBe("OPTIONS");
    expect(c!.facts).toMatchObject({ asset: "WETH", best: "Spark", bestRate: "3.97", current: "Aave", curRate: "1.47", delta: 250 });
    expect(tierOf(c!, policy)).toBe(0);
  });
  it("stays quiet under the threshold, when Aave already leads, or when the venue is too small", () => {
    expect(evaluate(pos, { yield: [row("Spark", 250), row("Aave", 147)] }, policy).some((x) => x.rule === "YIELD_OPP")).toBe(false);
    expect(evaluate(pos, { yield: [row("Aave", 500), row("Spark", 147)] }, policy).some((x) => x.rule === "YIELD_OPP")).toBe(false);
    expect(evaluate(pos, { yield: [row("Spark", 500, 100), row("Aave", 147)] }, policy).some((x) => x.rule === "YIELD_OPP")).toBe(false);
  });
  it("honours the ENS threshold", () => {
    const loose = { ...policy, yield_delta_bps: 50 };
    expect(evaluate(pos, { yield: [row("Compound", 250), row("Aave", 147)] }, loose).some((x) => x.rule === "YIELD_OPP")).toBe(true);
  });
});

describe("options card", () => {
  const market: MarketContext = { yield: [row("Spark", 397), row("Compound", 300), row("Aave", 147), row("Morpho", 800)] };
  const c = evaluate(pos, market, policy).find((x) => x.rule === "YIELD_OPP")!;

  it("lists at most three venues the policy allows, mapped to sims, with a capped slice", () => {
    const { card, filtered } = assembleOptions(c, dep, policy, ev, 1_800_000_000);
    expect(card.type).toBe("options");
    expect(card.items.length).toBeLessThanOrEqual(MAX_OPTIONS);
    expect(card.items.map((i) => i.protocol)).toEqual(["Spark", "Compound", "Aave"]);
    expect(card.items[0].sim).toBe(dep.simB);
    expect(card.items[2].sim).toBe(dep.simA);
    expect(BigInt(card.items[0].valueWei)).toBe(MOVE_WEI);
    expect(card.items[0].human).toBe("Spark WETH");
    expect(card.expiresAt).toBe(1_800_000_600);
    expect(filtered).toEqual([]);
  });

  it("drops every venue whose sim the Ledger did not allow", () => {
    const tight = { ...policy, allowed: policy.allowed.filter((a) => a.target !== dep.simB) };
    const { card, filtered } = assembleOptions(c, dep, tight, ev);
    expect(card.items.map((i) => i.protocol)).toEqual(["Aave"]);
    expect(filtered.join(" ")).toMatch(/Spark .*Sim-B/);
  });

  it("caps the slice by the policy's value cap", () => {
    const small = { ...policy, max_value_wei: 1_000_000_000_000_000n };
    const { card } = assembleOptions(c, dep, small, ev);
    expect(BigInt(card.items[0].valueWei)).toBe(1_000_000_000_000_000n);
  });

  it("a tap becomes a tier-2 supply on the chosen sim that passes the policy", () => {
    const { card } = assembleOptions(c, dep, policy, ev);
    const pick = pickCandidate(card, 0, c)!;
    expect(pick.action).toBe("MOVE_SUPPLY");
    expect(pick.sim).toBe(dep.simB);
    expect(pick.valueWei).toBe(MOVE_WEI);
    expect(tierOf(pick, policy)).toBe(2);
    const t = templateFor(pick);
    expect(t.human).toBe("Supply 0.01 ETH on Sim-B");
    expect(t.rationale).toBe("Spark WETH 3.97% beats Aave 1.47% by 250 bps; mainnet data, sim execution.");
    expect(t.rationale.length).toBeLessThanOrEqual(96);
    const v = withinPolicy({ chainId: dep.chainId, to: pick.sim, value: pick.valueWei, data: dep.selectors.supply, gas: 80_000, expiresAt: 4e9 }, policy);
    expect(v.ok).toBe(true);
    expect(pickCandidate(card, 7, c)).toBeUndefined();
  });

  it("exports the card for the firmware parser", () => {
    const { card } = assembleOptions(c, dep, policy, ev, 1_800_000_000);
    const dir = resolve(import.meta.dirname, "vectors");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "options.json"), `${JSON.stringify({ ...card, id: "01M24OPTIONSVECTOR000000000" }, null, 2)}\n`);
    expect(DEFAULT_POLICY.yield_delta_bps).toBe(150);
  });
});
