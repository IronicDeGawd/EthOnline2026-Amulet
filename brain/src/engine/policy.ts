// Policy: what the brain may propose. Same checks the pendant firmware performs, so an
// out-of-policy proposal is refused here first and, if the brain is compromised and skips
// this stage, refused again on the wrist. Records come from ENS (ens/resolver.ts); until
// then the defaults are built from the deployment file.
import { DEFAULT_POLICY, type Deployments, type Policy } from "../config.js";

export interface TxShape {
  chainId: number;
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
  gas: number;
  expiresAt: number;
}

export type PolicyVerdict = { ok: true } | { ok: false; reason: string };

export function defaultPolicy(dep: Deployments): Policy {
  const s = dep.selectors;
  return {
    ...DEFAULT_POLICY,
    allowed: [
      { target: dep.simA, selectors: [s.supply, s.repay] },
      { target: dep.simB, selectors: [s.supply, s.repay] },
      { target: dep.swapSim, selectors: [s.exactInputSingle] },
    ],
  };
}

export function selectorOf(data: string): `0x${string}` {
  return (data.length >= 10 ? data.slice(0, 10) : "0x00000000").toLowerCase() as `0x${string}`;
}

export function withinPolicy(tx: TxShape, policy: Policy, now = Math.floor(Date.now() / 1000)): PolicyVerdict {
  if (tx.chainId !== policy.chain) return { ok: false, reason: `chain ${tx.chainId} is not ${policy.chain}` };
  const entry = policy.allowed.find((a) => a.target.toLowerCase() === tx.to.toLowerCase());
  if (!entry) return { ok: false, reason: `target ${tx.to} is not allowed` };
  const sel = selectorOf(tx.data);
  if (tx.data !== "0x" && !entry.selectors.map((x) => x.toLowerCase()).includes(sel)) {
    return { ok: false, reason: `selector ${sel} is not allowed on ${tx.to}` };
  }
  if (tx.value > policy.max_value_wei) return { ok: false, reason: `value ${tx.value} exceeds cap ${policy.max_value_wei}` };
  if (tx.gas < 21_000 || tx.gas > 10_000_000) return { ok: false, reason: `gas ${tx.gas} out of range` };
  if (tx.expiresAt <= now) return { ok: false, reason: "already expired" };
  return { ok: true };
}

// Serialises the policy the way the ENS text records carry it, so both sides can be
// compared byte for byte in tests.
export function policyRecords(p: Policy): Record<string, string> {
  return {
    "amulet.version": String(p.version),
    "amulet.chain": String(p.chain),
    "amulet.allowed": p.allowed.map((a) => `${a.target}:${a.selectors.join(",")}`).join(";"),
    "amulet.max_value_wei": p.max_value_wei.toString(),
    "amulet.max_token_usd": String(p.max_token_usd),
    "amulet.tier1_hf": p.tier1_hf.toFixed(2),
    "amulet.tier2_hf": p.tier2_hf.toFixed(2),
    "amulet.drift_bps": String(p.drift_bps),
    "amulet.presence_timeout_s": String(p.presence_timeout_s),
    "amulet.yield_delta_bps": String(p.yield_delta_bps),
  };
}

export function policyFromRecords(rec: Record<string, string | undefined>, base: Policy = DEFAULT_POLICY): Policy {
  const num = (k: string, d: number) => (rec[k] !== undefined && rec[k] !== "" ? Number(rec[k]) : d);
  const allowed = rec["amulet.allowed"]
    ? rec["amulet.allowed"].split(";").filter(Boolean).map((part) => {
        const [target, sels] = part.split(":");
        return { target: target as `0x${string}`, selectors: (sels ?? "").split(",").filter(Boolean) as `0x${string}`[] };
      })
    : base.allowed;
  return {
    ...base,
    version: num("amulet.version", base.version),
    chain: num("amulet.chain", base.chain),
    allowed,
    max_value_wei: rec["amulet.max_value_wei"] ? BigInt(rec["amulet.max_value_wei"]) : base.max_value_wei,
    max_token_usd: num("amulet.max_token_usd", base.max_token_usd),
    tier1_hf: num("amulet.tier1_hf", base.tier1_hf),
    tier2_hf: num("amulet.tier2_hf", base.tier2_hf),
    drift_bps: num("amulet.drift_bps", base.drift_bps),
    presence_timeout_s: num("amulet.presence_timeout_s", base.presence_timeout_s),
    yield_delta_bps: num("amulet.yield_delta_bps", base.yield_delta_bps),
  };
}
