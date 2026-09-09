import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../src/config.js";
import { collateralAtHf, debtAtHf, evaluate } from "../src/engine/rules.js";
import { tierOf } from "../src/engine/tiers.js";
import { ethToDebtUnits, healthFactorOf, type Position } from "../src/chain/positionsim.js";
import { fakeHf } from "../src/brain.js";

const SIM = "0x9A6c374822AdA7AAA0590f1CE345a4FD949A467c" as const;
const USER = "0x211828006b402e0aae8244fB95B362b9eFFf7736" as const;

// The demo position: 0.05 ETH collateral, 60 sUSDC debt, price 2000, LT 80% -> HF 1.333
function position(price = 2000_00000000n, collateralWei = 50_000_000_000_000_000n, debtUnits = 60_000_000n): Position {
  return { sim: SIM, name: "Sim-A", user: USER, collateralWei, debtUnits, price, ltBps: 8000, healthFactor: healthFactorOf(collateralWei, price, 8000, debtUnits) };
}

describe("HF math mirrors PositionSim", () => {
  it("demo numbers", () => {
    expect(position().healthFactor).toBeCloseTo(1.3333, 4);
    expect(position(1600_00000000n).healthFactor).toBeCloseTo(1.0667, 4);
    expect(position(1600_00000000n, 50_000_000_000_000_000n, 44_000_000n).healthFactor).toBeCloseTo(1.4545, 4);
  });
  it("no debt is infinite", () => {
    expect(healthFactorOf(1n, 1n, 8000, 0n)).toBe(Infinity);
  });
  it("debtAtHf / collateralAtHf invert healthFactorOf", () => {
    const p = position(1600_00000000n);
    const d = debtAtHf(p, 1.4);
    expect(healthFactorOf(p.collateralWei, p.price, p.ltBps, d)).toBeCloseTo(1.4, 3);
    const c = collateralAtHf(p, 1.4);
    expect(healthFactorOf(c, p.price, p.ltBps, p.debtUnits)).toBeCloseTo(1.4, 3);
  });
});

describe("rules", () => {
  it("quiet when HF is above the warn line", () => {
    expect(evaluate(position(2400_00000000n), {}, DEFAULT_POLICY)).toEqual([]); // HF 1.60
  });
  it("the seeded demo position (1.33) already earns a tier-1 warning", () => {
    const [c] = evaluate(position(), {}, DEFAULT_POLICY);
    expect(c.rule).toBe("HF_WARN");
  });
  it("HF_LOW below 1.25 -> REPAY_DEBT sized to reach 1.40", () => {
    const p = position(1600_00000000n); // 1.067
    const [c] = evaluate(p, {}, DEFAULT_POLICY);
    expect(c.rule).toBe("HF_LOW");
    expect(c.action).toBe("REPAY_DEBT");
    expect(tierOf(c, DEFAULT_POLICY)).toBe(2);
    const repaid = ethToDebtUnits(c.valueWei, p.price);
    const after = healthFactorOf(p.collateralWei, p.price, p.ltBps, p.debtUnits - repaid);
    expect(after).toBeCloseTo(1.4, 2);
    expect(c.valueWei).toBeLessThanOrEqual(DEFAULT_POLICY.max_value_wei);
    expect(c.facts.amount).toMatch(/ETH$/);
    expect(c.facts.hf).toBe("1.07");
  });
  it("repay is capped by max_token_usd and max_value_wei", () => {
    const p = position(1600_00000000n, 5_000_000_000_000_000_000n, 6_000_000_000n); // big position, HF 1.067
    const [c] = evaluate(p, {}, DEFAULT_POLICY);
    expect(c.valueWei).toBeLessThanOrEqual(DEFAULT_POLICY.max_value_wei);
    expect(c.debtUnits!).toBeLessThanOrEqual(BigInt(DEFAULT_POLICY.max_token_usd) * 1_000_000n);
  });
  it("HF_WARN between 1.25 and 1.40 -> ADD_COLLATERAL tier 1", () => {
    const p = position(1900_00000000n); // 1.267
    const [c] = evaluate(p, {}, DEFAULT_POLICY);
    expect(c.rule).toBe("HF_WARN");
    expect(c.action).toBe("ADD_COLLATERAL");
    expect(tierOf(c, DEFAULT_POLICY)).toBe(1);
    const after = healthFactorOf(p.collateralWei + c.valueWei, p.price, p.ltBps, p.debtUnits);
    expect(after).toBeCloseTo(1.4, 2);
  });
  it("UTIL_SPIKE is an advisory, tier 0, needs a past sample", () => {
    const snap = { protocol: "Aave", market: "Aave Ethereum WETH", symbol: "WETH", depositUSD: 1, borrowUSD: 1, utilization: 0.92, supplyRateBps: 144, borrowRateBps: 204, liquidationThreshold: 83 };
    const healthy = position(2400_00000000n);
    expect(evaluate(healthy, { current: snap }, DEFAULT_POLICY)).toEqual([]);
    const [c] = evaluate(healthy, { current: snap, past: { ...snap, utilization: 0.8 } }, DEFAULT_POLICY);
    expect(c.rule).toBe("UTIL_SPIKE");
    expect(tierOf(c, DEFAULT_POLICY)).toBe(0);
    expect(c.valueWei).toBe(0n);
    expect(c.facts.market).toBe("Aave WETH");
  });
  it("fakeHf rescales the price so rules see the requested HF", () => {
    const p = fakeHf(position(), 1.15);
    expect(p.healthFactor).toBe(1.15);
    expect(healthFactorOf(p.collateralWei, p.price, p.ltBps, p.debtUnits)).toBeCloseTo(1.15, 3);
  });
});
