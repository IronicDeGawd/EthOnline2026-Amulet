import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../src/config.js";
import { brief, parseDecision, validate } from "../src/engine/decide.js";
import { healthFactorOf, type Position } from "../src/chain/positionsim.js";
import type { MarketContext } from "../src/engine/rules.js";
import type { YieldRow } from "../src/data/graph/yield.js";

const SIM = "0x9A6c374822AdA7AAA0590f1CE345a4FD949A467c" as const;
const USER = "0x211828006b402e0aae8244fB95B362b9eFFf7736" as const;
const EV = { deploymentId: "test", block: 1, queriedAt: 0, subgraph: "test" };

function position(price = 1600_00000000n, collateralWei = 50_000_000_000_000_000n, debtUnits = 60_000_000n): Position {
  return { sim: SIM, name: "Sim-A", user: USER, collateralWei, debtUnits, price, ltBps: 8000, healthFactor: healthFactorOf(collateralWei, price, 8000, debtUnits) };
}

const rows: YieldRow[] = [
  { protocol: "Spark", market: "Spark WETH", symbol: "WETH", supplyRateBps: 397, depositUSD: 1.3e9, evidence: EV },
  { protocol: "Aave", market: "Aave WETH", symbol: "WETH", supplyRateBps: 147, depositUSD: 5.2e9, evidence: EV },
];
const market: MarketContext = { yield: rows };
const policy = { ...DEFAULT_POLICY, max_value_wei: 10_000_000_000_000_000n };

describe("reading the model's answer", () => {
  it("takes JSON out of surrounding chatter", () => {
    const d = parseDecision('sure thing {"act": true, "action": "repay_debt", "market": "Sim-A", "amountEth": "0.004", "why": "health factor is low"}');
    expect(d?.act).toBe(true);
    expect(d?.action).toBe("REPAY_DEBT");
    expect(d?.amountEth).toBe("0.004");
  });

  it("accepts a bare refusal to act", () => {
    expect(parseDecision('{"act": false, "why": "nothing worth interrupting for"}')).toEqual({ act: false, why: "nothing worth interrupting for" });
  });

  it("takes a number as well as a string amount", () => {
    expect(parseDecision('{"act": true, "action": "ADD_COLLATERAL", "amountEth": 0.002}')?.amountEth).toBe("0.002");
  });

  it("rejects prose with no JSON at all", () => {
    expect(parseDecision("I would repay about 0.004 ETH.")).toBeUndefined();
  });

  it("rejects JSON that never says whether to act", () => {
    expect(parseDecision('{"action": "REPAY_DEBT", "amountEth": "0.004"}')).toBeUndefined();
  });
});

describe("checking it against the policy it was shown", () => {
  it("lets a sane repay through and recomputes the figures itself", () => {
    const v = validate({ act: true, action: "REPAY_DEBT", market: "Sim-A", amountEth: "0.004" }, position(), market, policy);
    expect(v.candidate?.action).toBe("REPAY_DEBT");
    // The amount the wearer sees is derived from the debt units, not copied from the model.
    expect(v.candidate?.facts.amount).toMatch(/ETH$/);
    expect(v.candidate!.valueWei).toBeLessThanOrEqual(policy.max_value_wei);
  });

  it("drops an amount over the agent's own cap", () => {
    const v = validate({ act: true, action: "ADD_COLLATERAL", amountEth: "0.02" }, position(), market, policy);
    expect(v.candidate).toBeUndefined();
    expect(v.reason).toContain("over its own cap");
  });

  it("drops a market it was never given", () => {
    const v = validate({ act: true, action: "REPAY_DEBT", market: "Aave Mainnet", amountEth: "0.004" }, position(), market, policy);
    expect(v.candidate).toBeUndefined();
    expect(v.reason).toContain("not one it may touch");
  });

  it("drops an action that does not exist", () => {
    const v = validate({ act: true, action: "DRAIN_WALLET" as never, amountEth: "0.001" }, position(), market, policy);
    expect(v.candidate).toBeUndefined();
    expect(v.reason).toContain("unknown action");
  });

  it("drops a repay when there is no debt", () => {
    const v = validate({ act: true, action: "REPAY_DEBT", amountEth: "0.004" }, position(1600_00000000n, 50_000_000_000_000_000n, 0n), market, policy);
    expect(v.candidate).toBeUndefined();
    expect(v.reason).toContain("does not exist");
  });

  it("drops an amount that is not a number", () => {
    const v = validate({ act: true, action: "ADD_COLLATERAL", amountEth: "some" }, position(), market, policy);
    expect(v.candidate).toBeUndefined();
  });

  it("drops zero", () => {
    const v = validate({ act: true, action: "ADD_COLLATERAL", amountEth: "0" }, position(), market, policy);
    expect(v.reason).toContain("zero");
  });

  it("drops a move when the spread is under the policy's threshold", () => {
    const thin: MarketContext = { yield: [{ ...rows[0], supplyRateBps: 200 }, rows[1]] };
    const v = validate({ act: true, action: "MOVE_SUPPLY", amountEth: "0.002" }, position(), thin, { ...policy, yield_delta_bps: 150 });
    expect(v.candidate).toBeUndefined();
    expect(v.reason).toContain("bps");
  });

  it("lets a move through when the spread is real", () => {
    const v = validate({ act: true, action: "MOVE_SUPPLY", amountEth: "0.002" }, position(), market, { ...policy, yield_delta_bps: 150 });
    expect(v.candidate?.action).toBe("MOVE_SUPPLY");
    expect(v.candidate?.facts.best).toBe("Spark");
  });

  it("passes a decision not to act straight through", () => {
    const v = validate({ act: false, why: "position is comfortable" }, position(), market, policy);
    expect(v.candidate).toBeUndefined();
    expect(v.reason).toContain("comfortable");
  });
});

describe("what the model is told", () => {
  it("shows it its own cap and its own market", () => {
    const { system, user } = brief(position(), market, policy, "You are a cautious guardian.");
    expect(system).toContain("cautious guardian");
    expect(user).toContain("0.01 ETH");
    expect(user).toContain("Sim-A");
    expect(user).toContain("health factor");
  });
});

describe("naming a venue on a move", () => {
  it("accepts the venue it wants to move to, and still executes on its own market", () => {
    const v = validate({ act: true, action: "MOVE_SUPPLY", market: "Spark WETH", amountEth: "0.002" }, position(), market, { ...policy, yield_delta_bps: 150 });
    expect(v.candidate?.action).toBe("MOVE_SUPPLY");
    expect(v.candidate?.sim).toBe(SIM); // never an address the model supplied
    expect(v.candidate?.simName).toBe("Sim-A");
  });

  it("still refuses a venue that is nowhere in the ranking", () => {
    const v = validate({ act: true, action: "MOVE_SUPPLY", market: "Tortuga Yield Farm", amountEth: "0.002" }, position(), market, { ...policy, yield_delta_bps: 150 });
    expect(v.candidate).toBeUndefined();
    expect(v.reason).toContain("not one it may touch");
  });

  it("refuses a made-up market on a repay, where no venue naming applies", () => {
    const v = validate({ act: true, action: "REPAY_DEBT", market: "Spark WETH", amountEth: "0.004" }, position(), market, policy);
    expect(v.candidate).toBeUndefined();
  });
});

describe("what is worth a second attempt", () => {
  it("corrects the mistakes that are its own", async () => {
    const { correctable } = await import("../src/engine/decide.js");
    expect(correctable("0.02 ETH is over its own cap of 0.01 ETH")).toBe(true);
    expect(correctable('market "Tortuga" is not one it may touch (Sim-A)')).toBe(true);
    expect(correctable("unknown action DRAIN_WALLET")).toBe(true);
    expect(correctable("amount is zero")).toBe(true);
  });

  it("does not argue with a decision that was not a mistake", async () => {
    const { correctable } = await import("../src/engine/decide.js");
    expect(correctable("stood down: the position is comfortable")).toBe(false);
    expect(correctable("no yield table to move against")).toBe(false);
    expect(correctable("3 bps is under the 150 bps its policy asks for")).toBe(false);
    expect(correctable("asked to repay a debt that does not exist")).toBe(false);
  });
});

describe("being told it was refused", () => {
  it("carries the last refusal into the brief", async () => {
    const { brief } = await import("../src/engine/decide.js");
    const { user } = brief(position(), market, policy, "guardian", undefined, undefined, "the device refused \"Add 0.02 ETH\" — it broke your limits");
    expect(user).toContain("the last time you asked, it was refused");
    expect(user).toContain("broke your limits");
  });
});

describe("amounts that are not amounts", () => {
  it("keeps a negative amount negative instead of tidying it into a positive one", async () => {
    const { parseDecision } = await import("../src/engine/decide.js");
    const d = parseDecision('{"act": true, "action": "ADD_COLLATERAL", "amountEth": "-0.5"}');
    expect(d?.amountEth).toBe("-0.5");
    expect(validate(d!, position(), market, policy).candidate).toBeUndefined();
  });

  it("refuses a negative number too", async () => {
    const { parseDecision } = await import("../src/engine/decide.js");
    const d = parseDecision('{"act": true, "action": "ADD_COLLATERAL", "amountEth": -0.5}');
    expect(validate(d!, position(), market, policy).candidate).toBeUndefined();
  });
});

describe("the rest of the checks", () => {
  it("never repays more than is owed", () => {
    // 0.01 ETH at $1600 is ~$16, well over the $10 of debt on this position
    const p = position(1600_00000000n, 50_000_000_000_000_000n, 10_000_000n);
    const v = validate({ act: true, action: "REPAY_DEBT", amountEth: "0.01" }, p, market, policy);
    expect(v.candidate?.debtUnits).toBe(10_000_000n);
  });

  it("refuses a repay too small to touch the debt", () => {
    const v = validate({ act: true, action: "REPAY_DEBT", amountEth: "0.0000000001" }, position(), market, policy);
    expect(v.candidate).toBeUndefined();
    expect(v.reason).toMatch(/too small|zero/);
  });

  it("refuses a move to a venue too thin to hold the position", () => {
    const thin: MarketContext = { yield: [{ ...rows[0], depositUSD: 1 }, rows[1]] };
    const v = validate({ act: true, action: "MOVE_SUPPLY", amountEth: "0.002" }, position(), thin, { ...policy, yield_delta_bps: 150 });
    expect(v.candidate).toBeUndefined();
    expect(v.reason).toContain("too thin");
  });

  it("refuses a move when the current venue already pays the most", () => {
    const here: MarketContext = { yield: [rows[1], { ...rows[0], supplyRateBps: 10 }] };
    const v = validate({ act: true, action: "MOVE_SUPPLY", amountEth: "0.002" }, position(), here, policy);
    expect(v.candidate).toBeUndefined();
    expect(v.reason).toContain("already pays the most");
  });

  it("refuses a move with no ranking to move against", () => {
    const v = validate({ act: true, action: "MOVE_SUPPLY", amountEth: "0.002" }, position(), {}, policy);
    expect(v.candidate).toBeUndefined();
    expect(v.reason).toContain("no yield table");
  });
});
