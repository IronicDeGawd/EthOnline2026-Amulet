import { describe, expect, it } from "vitest";
import { checkFreshness } from "../src/data/graph/freshness.js";
import { SUBGRAPHS } from "../src/config.js";

const pinned = SUBGRAPHS.aaveV3.deployment;
const meta = (block: number, deployment: string = pinned, hasIndexingErrors = false) => ({ block: { number: block }, deployment, hasIndexingErrors });

describe("freshness gate", () => {
  it("rejects a different deployment even at head", () => {
    const v = checkFreshness("aaveV3", meta(100, "QmSomethingElse"), 100, 1);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("wrong_deployment");
  });
  it("rejects lag 6", () => {
    const v = checkFreshness("aaveV3", meta(94), 100, 1);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("stale");
  });
  it("accepts lag 5 and carries evidence", () => {
    const v = checkFreshness("aaveV3", meta(95), 100, 1234);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.lag).toBe(5);
      expect(v.evidence).toEqual({ deploymentId: pinned, block: 95, queriedAt: 1234, subgraph: "Aave V3 Ethereum" });
    }
  });
  it("rejects indexing errors", () => {
    const v = checkFreshness("aaveV3", meta(100, pinned, true), 100, 1);
    expect(v.ok).toBe(false);
  });
  it("a pinned override is what `amulet stale` uses", () => {
    const v = checkFreshness("aaveV3", meta(100), 100, 1, undefined, "QmWrong");
    expect(v.ok).toBe(false);
  });
});
