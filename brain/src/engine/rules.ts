// Deterministic rules: (position, market, policy) -> candidates. No model in the loop here;
// the LLM only explains what these rules decided. Amounts are sized by HF arithmetic that
// mirrors PositionSim.sol so the number on the pendant is the number that lands on chain.
import type { Policy } from "../config.js";
import { debtUnitsToWei, type Position } from "../chain/positionsim.js";
import type { MarketSnapshot } from "../data/graph/lending.js";

export type Rule = "HF_LOW" | "HF_WARN" | "UTIL_SPIKE" | "REBALANCE";
export type Action = "REPAY_DEBT" | "ADD_COLLATERAL" | "ADVISORY" | "SWAP";

export interface Candidate {
  rule: Rule;
  action: Action;
  sim: `0x${string}`;
  simName: string;
  valueWei: bigint; // ETH sent with the call (0 for advisories)
  debtUnits?: bigint; // sUSDC units affected, for the text
  facts: Record<string, string | number>; // exact figures the explainer must repeat verbatim
}

export interface MarketContext {
  current?: MarketSnapshot; // the watched mainnet market (Aave WETH)
  past?: MarketSnapshot; // the same market `util_window_blocks` ago, if known
}

const WEI = 10n ** 18n;

// Inverts healthFactorOf: hf(1e18) = coll*price*LT / (debt*1e6). targetHf is carried as 1e4,
// so hf(1e18) = target1e4 * 1e14.

// Debt (sUSDC units) that puts the position exactly at targetHf.
export function debtAtHf(p: Position, targetHf: number): bigint {
  const target1e4 = BigInt(Math.round(targetHf * 10_000));
  return (p.collateralWei * p.price * BigInt(p.ltBps)) / (target1e4 * 10n ** 20n);
}

// Collateral (wei) that puts the position exactly at targetHf.
export function collateralAtHf(p: Position, targetHf: number): bigint {
  const target1e4 = BigInt(Math.round(targetHf * 10_000));
  return (target1e4 * p.debtUnits * 10n ** 20n) / (p.price * BigInt(p.ltBps));
}

function fmtEth(wei: bigint): string {
  const s = (Number(wei) / 1e18).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return `${s} ETH`;
}

function fmtUsd(units: bigint): string {
  return `$${(Number(units) / 1e6).toFixed(2)}`;
}

export function evaluate(p: Position, market: MarketContext, policy: Policy): Candidate[] {
  const out: Candidate[] = [];
  const hf = p.healthFactor;

  if (p.debtUnits > 0n && hf < policy.tier2_hf) {
    // Repay enough debt to reach the target HF, capped by the token cap and the value cap.
    let units = p.debtUnits - debtAtHf(p, policy.target_hf);
    if (units < 0n) units = 0n;
    const capUnits = BigInt(policy.max_token_usd) * 1_000_000n;
    if (units > capUnits) units = capUnits;
    if (units > p.debtUnits) units = p.debtUnits;
    let valueWei = debtUnitsToWei(units, p.price) + 1n; // +1 wei covers the integer floor
    if (valueWei > policy.max_value_wei) {
      valueWei = policy.max_value_wei;
      units = (valueWei * p.price) / 10n ** 20n;
    }
    if (units > 0n) {
      out.push({
        rule: "HF_LOW", action: "REPAY_DEBT", sim: p.sim, simName: p.name, valueWei, debtUnits: units,
        facts: {
          hf: hf.toFixed(2), threshold: policy.tier2_hf.toFixed(2), target: policy.target_hf.toFixed(2),
          amount: fmtEth(valueWei), debt: fmtUsd(units), market: p.name,
        },
      });
    }
  } else if (p.debtUnits > 0n && hf < policy.tier1_hf) {
    let addWei = collateralAtHf(p, policy.target_hf) - p.collateralWei;
    if (addWei < 0n) addWei = 0n;
    if (addWei > policy.max_value_wei) addWei = policy.max_value_wei;
    if (addWei > 0n) {
      out.push({
        rule: "HF_WARN", action: "ADD_COLLATERAL", sim: p.sim, simName: p.name, valueWei: addWei,
        facts: {
          hf: hf.toFixed(2), threshold: policy.tier1_hf.toFixed(2), target: policy.target_hf.toFixed(2),
          amount: fmtEth(addWei), market: p.name,
        },
      });
    }
  }

  if (market.current && market.past) {
    const delta = (market.current.utilization - market.past.utilization) * 100;
    if (delta > policy.util_spike_pts) {
      out.push({
        rule: "UTIL_SPIKE", action: "ADVISORY", sim: p.sim, simName: p.name, valueWei: 0n,
        facts: {
          // "Aave WETH", short enough for the pendant's unit line
          market: `${market.current.protocol} ${market.current.symbol}`,
          from: (market.past.utilization * 100).toFixed(1),
          to: (market.current.utilization * 100).toFixed(1), delta: delta.toFixed(1),
          borrowRate: (market.current.borrowRateBps / 100).toFixed(2), window: policy.util_window_blocks,
        },
      });
    }
  }

  return out;
}

export { WEI };
