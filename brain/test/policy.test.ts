import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadDeployments } from "../src/config.js";
import { defaultPolicy, policyFromRecords, policyRecords, withinPolicy, type TxShape } from "../src/engine/policy.js";

const dep = loadDeployments();
const policy = defaultPolicy(dep);
const NOW = 1_800_000_000;

const ok: TxShape = { chainId: 11155111, to: dep.simA, value: 10_000_000_000_000_000n, data: `${dep.selectors.repay}` as `0x${string}`, gas: 80_000, expiresAt: NOW + 600 };

// Every vector is also written to test/vectors/policy.json for the firmware's policy unit test.
const vectors: { name: string; tx: TxShape; expect: boolean }[] = [
  { name: "repay on simA within cap", tx: ok, expect: true },
  { name: "supply on simB", tx: { ...ok, to: dep.simB, data: dep.selectors.supply }, expect: true },
  { name: "exactInputSingle on swapSim", tx: { ...ok, to: dep.swapSim, data: dep.selectors.exactInputSingle }, expect: true },
  { name: "unknown target", tx: { ...ok, to: "0x000000000000000000000000000000000000dEaD" }, expect: false },
  { name: "withdraw selector not allowed", tx: { ...ok, data: dep.selectors.withdraw }, expect: false },
  { name: "setPrice selector not allowed", tx: { ...ok, data: dep.selectors.setPrice }, expect: false },
  { name: "5 ETH over cap", tx: { ...ok, value: 5_000_000_000_000_000_000n }, expect: false },
  { name: "exactly at cap", tx: { ...ok, value: policy.max_value_wei }, expect: true },
  { name: "wrong chain", tx: { ...ok, chainId: 1 }, expect: false },
  { name: "expired", tx: { ...ok, expiresAt: NOW - 1 }, expect: false },
  { name: "gas too low", tx: { ...ok, gas: 20_999 }, expect: false },
  { name: "gas too high", tx: { ...ok, gas: 10_000_001 }, expect: false },
  // A plain ETH transfer has no selector to check: allowed to a listed target, capped by value.
  { name: "plain transfer to listed target", tx: { ...ok, data: "0x", gas: 21_000 }, expect: true },
  { name: "plain transfer to listed target over cap", tx: { ...ok, data: "0x", gas: 21_000, value: 5_000_000_000_000_000_000n }, expect: false },
  { name: "plain transfer to unknown target", tx: { ...ok, data: "0x", gas: 21_000, to: "0x000000000000000000000000000000000000dEaD" }, expect: false },
];

describe("policy", () => {
  for (const v of vectors) {
    it(v.name, () => expect(withinPolicy(v.tx, policy, NOW).ok).toBe(v.expect));
  }
  it("records round-trip", () => {
    const rec = policyRecords(policy);
    expect(rec["amulet.allowed"]).toContain(`${dep.simA}:${dep.selectors.supply},${dep.selectors.repay}`);
    const back = policyFromRecords(rec);
    expect(back.max_value_wei).toBe(policy.max_value_wei);
    expect(back.allowed).toEqual(policy.allowed);
    expect(back.tier2_hf).toBe(1.25);
  });
  it("a raised limit from records changes the verdict", () => {
    const raised = policyFromRecords({ ...policyRecords(policy), "amulet.max_value_wei": "5000000000000000000" });
    expect(withinPolicy({ ...ok, value: 5_000_000_000_000_000_000n }, raised, NOW).ok).toBe(true);
  });
  it("exports vectors for the firmware", () => {
    const dir = resolve(import.meta.dirname, "vectors");
    mkdirSync(dir, { recursive: true });
    const out = {
      now: NOW,
      policy: policyRecords(policy),
      vectors: vectors.map((v) => ({ name: v.name, tx: { ...v.tx, value: `0x${v.tx.value.toString(16)}` }, expect: v.expect })),
    };
    writeFileSync(resolve(dir, "policy.json"), `${JSON.stringify(out, null, 2)}\n`);
    expect(out.vectors.length).toBe(vectors.length);
  });
});
