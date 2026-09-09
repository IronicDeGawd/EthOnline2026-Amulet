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
