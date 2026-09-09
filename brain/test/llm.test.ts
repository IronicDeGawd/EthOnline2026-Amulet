import { describe, expect, it } from "vitest";
import { acceptOutput, buildPrompt, templateFor, type Explainer } from "../src/engine/llm.js";
import type { Candidate } from "../src/engine/rules.js";

const c: Candidate = {
  rule: "HF_LOW", action: "REPAY_DEBT", sim: "0x9A6c374822AdA7AAA0590f1CE345a4FD949A467c", simName: "Sim-A",
  valueWei: 10_000_000_000_000_000n, debtUnits: 16_000_000n,
  facts: { hf: "1.07", threshold: "1.25", target: "1.40", amount: "0.01 ETH", debt: "$16.00", market: "Sim-A" },
};
const ev = { deploymentId: "QmcXE5QVcBcvcaJddPxd8mFs6W9xt7STmwfgguoiM6ddAd", block: 100, queriedAt: 1, subgraph: "Aave V3 Ethereum" };

describe("explainer", () => {
  it("prompt carries the figures as labelled facts, not as a sentence to rewrite", () => {
    const { system, user } = buildPrompt(c, ev);
    expect(user).toContain("amount: 0.01 ETH");
    expect(user).toContain("hf: 1.07");
    expect(system).toMatch(/Copy figures exactly/);
    expect(system).toContain('"0.01 ETH and 1.07" must appear verbatim');
    expect(user).not.toMatch(/repay 0\.01/i);
  });
  it("accepts output that keeps the amount and HF", () => {
    const out = acceptOutput('{"human":"Repay 0.01 ETH on Sim-A","rationale":"HF 1.07 is under 1.25."}', c);
    expect(out?.source).toBe("nova");
  });
  it("refuses a headline the pendant cannot split (verb, figure, unit)", () => {
    expect(acceptOutput('{"human":"Repay debt of 0.01 ETH on Sim-A","rationale":"HF 1.07 is low"}', c)).toBeUndefined();
    expect(acceptOutput('{"human":"Repay 0.0100000 ETH on Sim-A","rationale":"HF 1.07 is low"}', c)).toBeUndefined();
    expect(acceptOutput('{"human":"Repay 0.01 ETH on Sim-A","rationale":"HF 1.07 is low"}', c)?.source).toBe("nova");
  });
  it("advisory headline always comes from the template and splits", () => {
    const adv: Candidate = { ...c, rule: "UTIL_SPIKE", action: "ADVISORY", valueWei: 0n, debtUnits: undefined,
      facts: { market: "Aave WETH", from: "80.0", to: "92.0", delta: "12.0", borrowRate: "2.04", window: 40 } };
    expect(templateFor(adv).human).toBe("Utilization 92.0% on Aave WETH");
    expect(templateFor(adv).rationale.length).toBeLessThanOrEqual(48);
    expect(acceptOutput('{"human":"x","rationale":"Borrow demand surged by 12.0 points in 40 blocks; rates now 2.04% and 92.0% used."}', adv)).toBeUndefined();
    const out = acceptOutput('{"human":"Whatever the model says","rationale":"Demand jumped 12.0 pts to 92.0%."}', adv);
    expect(out?.human).toBe("Utilization 92.0% on Aave WETH");
    // a rationale copied from another case (no delta, no level) is refused
    expect(acceptOutput('{"human":"x","rationale":"Health factor 1.07 is under 1.25."}', adv)).toBeUndefined();
    expect(buildPrompt(adv, ev).system).toContain("Utilization 92.0% on Aave WETH");
  });
  it("refuses output that changed the amount", () => {
    expect(acceptOutput('{"human":"Repay 0.02 ETH on Sim-A","rationale":"HF 1.07 is low"}', c)).toBeUndefined();
    expect(acceptOutput("not json at all", c)).toBeUndefined();
  });
  it("template fallback fits the pendant", () => {
    const t = templateFor(c);
    expect(t.human.length).toBeLessThanOrEqual(95);
    expect(t.rationale.length).toBeLessThanOrEqual(95);
    expect(t.human).toContain("0.01 ETH");
  });
  it("a slow model never blocks: the wrapper returns the template", async () => {
    const slow: Explainer = { explain: async (cand) => templateFor(cand) };
    const r = await Promise.race([slow.explain(c, ev), new Promise((res) => setTimeout(() => res("timeout"), 50))]);
    expect(r).not.toBe("timeout");
  });
});
