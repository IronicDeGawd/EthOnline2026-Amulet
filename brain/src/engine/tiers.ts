// Tier by rule, then bumped by size: anything above the value cap is never "small".
import type { Policy } from "../config.js";
import type { Candidate, Rule } from "./rules.js";

export type Tier = 0 | 1 | 2;

const BASE: Record<Rule, Tier> = { HF_LOW: 2, HF_WARN: 1, UTIL_SPIKE: 0, REBALANCE: 2, YIELD_OPP: 0 };

export function tierOf(c: Candidate, policy: Policy): Tier {
  let t = BASE[c.rule];
  if (c.action === "MOVE_SUPPLY") t = 2; // the pick behind a yield card is a real signature
  if (t === 1 && c.valueWei > policy.max_value_wei) t = 2;
  return t;
}
