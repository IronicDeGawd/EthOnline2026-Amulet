// Reads the policy from ENS text records through the Universal Resolver, the same way any
// wallet would, so the name is the source of truth rather than an address we memorised.
import type { PublicClient } from "viem";
import { normalize } from "viem/ens";
import { DEFAULT_POLICY, ENS, POLICY_KEYS, POLICY_NAME, STATUS_KEYS, type Policy } from "../config.js";
import { policyFromRecords } from "../engine/policy.js";

export interface PolicyRead {
  policy: Policy;
  records: Record<string, string>;
  fetchedAt: number;
  name: string;
}

export async function readRecords(client: PublicClient, keys: readonly string[], name = POLICY_NAME): Promise<Record<string, string>> {
  const n = normalize(name);
  const values = await Promise.all(
    keys.map((key) => client.getEnsText({ name: n, key, universalResolverAddress: ENS.universalResolver })),
  );
  const out: Record<string, string> = {};
  keys.forEach((k, i) => { if (values[i] !== null && values[i] !== undefined) out[k] = values[i] as string; });
  return out;
}

// The version and chain records must be there: a name with no policy is not a policy of
// "anything goes", it is a misconfiguration the brain refuses to run on.
export async function readPolicy(client: PublicClient, name = POLICY_NAME, base: Policy = DEFAULT_POLICY): Promise<PolicyRead> {
  const records = await readRecords(client, [...POLICY_KEYS, ...STATUS_KEYS, "amulet.brain", "amulet.endpoint"], name);
  return { policy: policyFromRead(records, base), records, fetchedAt: Date.now(), name };
}

export function policyFromRead(records: Record<string, string>, base: Policy = DEFAULT_POLICY): Policy {
  for (const k of ["amulet.version", "amulet.chain", "amulet.allowed", "amulet.max_value_wei"]) {
    if (!records[k]) throw new Error(`ENS policy incomplete: ${k} missing`);
  }
  return policyFromRecords(records, base);
}

// Human diff between two policies, one line per changed field; empty when equal.
export function policyDiff(a: Policy, b: Policy): string[] {
  const lines: string[] = [];
  for (const k of Object.keys(b) as (keyof Policy)[]) {
    const x = a[k], y = b[k];
    const sx = typeof x === "object" ? JSON.stringify(x) : String(x);
    const sy = typeof y === "object" ? JSON.stringify(y) : String(y);
    if (sx !== sy) lines.push(`${k}: ${sx} → ${sy}`);
  }
  return lines;
}
