import { describe, expect, it } from "vitest";
import { namehash } from "viem/ens";
import { DEFAULT_POLICY, POLICY_NAME } from "../src/config.js";
import { policyDiff, policyFromRead } from "../src/ens/resolver.js";
import { policyRecords } from "../src/engine/policy.js";
import { shouldWrite } from "../src/ens/status.js";
import { dnsName, policyNode } from "../src/ens/setup.js";
import { decodeAccountData, formatView } from "../src/chain/account.js";
import { adm, PR, RR } from "../src/ens/abi.js";

const base = {
  ...DEFAULT_POLICY,
  allowed: [{ target: "0x9A6c374822AdA7AAA0590f1CE345a4FD949A467c" as const, selectors: ["0x402d8883", "0x047fc9aa"] as `0x${string}`[] }],
};

describe("policy from ENS records", () => {
  it("round-trips through the record shape", () => {
    const rec = policyRecords(base);
    const p = policyFromRead(rec, DEFAULT_POLICY);
    expect(p.allowed).toEqual(base.allowed);
    expect(p.max_value_wei).toBe(base.max_value_wei);
    expect(p.tier1_hf).toBe(1.4);
    expect(p.chain).toBe(11155111);
  });

  it("fails closed on a record that is not a number", () => {
    const rec = { ...policyRecords(base), "amulet.tier2_hf": "1.25 x" };
    expect(() => policyFromRead(rec, DEFAULT_POLICY)).toThrow(/tier2_hf is not a number/);
    const bad = { ...policyRecords(base), "amulet.max_value_wei": "lots" };
    expect(() => policyFromRead(bad, DEFAULT_POLICY)).toThrow();
  });

  it("refuses a name with no policy on it", () => {
    expect(() => policyFromRead({}, DEFAULT_POLICY)).toThrow(/amulet.version missing/);
    expect(() => policyFromRead({ "amulet.version": "1", "amulet.chain": "11155111" }, DEFAULT_POLICY)).toThrow(/amulet.allowed/);
  });

  it("diffs field by field", () => {
    const changed = { ...base, max_value_wei: 20_000_000_000_000_000n, tier2_hf: 1.3 };
    const d = policyDiff(base, changed);
    expect(d).toHaveLength(2);
    expect(d[0]).toMatch(/max_value_wei: 50000000000000000 → 20000000000000000/);
    expect(policyDiff(base, base)).toEqual([]);
  });
});

describe("names", () => {
  it("node is the namehash of guardian.amuletguard.eth", () => {
    expect(policyNode()).toBe(namehash("guardian.amuletguard.eth"));
    expect(POLICY_NAME).toBe("guardian.amuletguard.eth");
  });
  it("DNS wire format: length-prefixed labels, zero terminated", () => {
    // 8 "guardian" 11 "amuletguard" 3 "eth" 0
    expect(dnsName("guardian.amuletguard.eth")).toBe("0x08677561726469616e0b616d756c657467756172640365746800");
  });
});

describe("roles", () => {
  it("admin bit sits 128 above the role", () => {
    expect(adm(PR.SET_TEXT)).toBe((1n << 4n) | (1n << 132n));
    expect(RR.CAN_TRANSFER_ADMIN).toBe(1n << 156n);
  });
});

describe("status writer dedup", () => {
  it("writes on change only", () => {
    const last = new Map<string, string>();
    expect(shouldWrite(last, "amulet.status", "watching")).toBe(true);
    last.set("amulet.status", "watching");
    expect(shouldWrite(last, "amulet.status", "watching")).toBe(false);
    expect(shouldWrite(last, "amulet.status", "proposing")).toBe(true);
  });
});

describe("mainnet view", () => {
  const addr = "0xff10000000000000000000000000000000BFCa4a" as const;
  it("decodes Aave base units and the no-debt sentinel", () => {
    const v = decodeAccountData("x.eth", addr, 1_234_00000000n, 0n, 2n ** 256n - 1n);
    expect(v.collateralUsd).toBe(1234);
    expect(v.healthFactor).toBe(Infinity);
    expect(formatView(v)).toMatch(/HF ∞/);
  });
  it("says so when there is nothing there", () => {
    const v = decodeAccountData("x.eth", addr, 0n, 0n, 2n ** 256n - 1n);
    expect(v.hasPosition).toBe(false);
    expect(formatView(v)).toMatch(/no Aave v3 position/);
  });
  it("computes HF from the 1e18 scale", () => {
    const v = decodeAccountData("x.eth", addr, 10_000_00000000n, 4_000_00000000n, 1_950_000_000_000_000_000n);
    expect(v.healthFactor).toBeCloseTo(1.95);
    expect(formatView(v)).toMatch(/debt \$4000.00 HF 1.95/);
  });
});
