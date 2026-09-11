// The wearer asks for a swap; the agent finds the route.
//
// The rate is quoted live from LI.FI, which aggregates real DEXes on mainnet — that is where
// the liquidity is, and where a quote means something. The execution happens on SwapSim on
// Sepolia, which takes Uniswap v3's exact `exactInputSingle` signature, so the calldata the
// Ledger sees has the same shape it would have against the real router. The pendant says so:
// quoted on mainnet, executed on the sim. The same honesty the yield card already uses.
import { encodeFunctionData, parseAbi } from "viem";
import type { Deployments } from "../config.js";

export type Side = "ETH" | "USDC";

// Mainnet addresses, used only to ask for a price. Nothing is ever sent to them.
const MAINNET = {
  ETH: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const, // LI.FI's native-token sentinel
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const,
};

export const SWAP_ABI = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)",
]);

export const POOL_FEE = 3000; // 0.3%, the tier SwapSim charges

export interface SwapQuote {
  route: string;        // the venue LI.FI picked, shown to the wearer
  outUnits: bigint;     // what mainnet would give, in the destination's own decimals
  rate: number;         // destination units per whole source unit
  gasUsd: number;
  from: Side;
  to: Side;
  amountIn: bigint;
}

const DECIMALS: Record<Side, number> = { ETH: 18, USDC: 6 };

// Live, and allowed to fail: a swap the agent cannot price is a swap it should not propose.
export async function quoteSwap(from: Side, to: Side, amountIn: bigint, timeoutMs = 10_000): Promise<SwapQuote | undefined> {
  if (from === to) return undefined;
  const url =
    "https://li.quest/v1/quote?fromChain=1&toChain=1" +
    `&fromToken=${MAINNET[from]}&toToken=${MAINNET[to]}&fromAmount=${amountIn}` +
    "&fromAddress=0x000000000000000000000000000000000000dEaD&integrator=amulet";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return undefined;
    const j = (await res.json()) as {
      toolDetails?: { name?: string };
      estimate?: { toAmount?: string; gasCosts?: { amountUSD?: string }[] };
    };
    const out = j.estimate?.toAmount;
    if (!out) return undefined;
    const outUnits = BigInt(out);
    if (outUnits <= 0n) return undefined;
    const rate = Number(outUnits) / 10 ** DECIMALS[to] / (Number(amountIn) / 10 ** DECIMALS[from]);
    return {
      route: String(j.toolDetails?.name ?? "an aggregator"),
      outUnits,
      rate,
      gasUsd: (j.estimate?.gasCosts ?? []).reduce((n, g) => n + Number(g.amountUSD ?? 0), 0),
      from, to, amountIn,
    };
  } catch {
    return undefined;
  }
}

// What the sim will actually pay out, by its own arithmetic — the same formula SwapSim uses,
// so the minimum we demand is one the sim can meet. Never derived from the mainnet quote:
// the sim prices off its own oracle-synced price and would revert against a mainnet number.
export function simOut(from: Side, amountIn: bigint, simPrice: bigint): bigint {
  const afterFee = (x: bigint) => (x * 9970n) / 10_000n; // FEE_BPS = 30
  return from === "ETH"
    ? afterFee((amountIn * simPrice) / 10n ** 20n)
    : afterFee((amountIn * 10n ** 20n) / simPrice);
}

export interface BuiltSwap {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  human: string;
  rationale: string;
  minOut: bigint;
}

export function fmt(units: bigint, side: Side): string {
  const n = Number(units) / 10 ** DECIMALS[side];
  return `${side === "ETH" ? n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : n.toFixed(2)} ${side}`;
}

// Slippage is a floor, not a hope: the sim must return at least this or revert. One percent
// covers the price moving between the quote and the signature.
export const SLIPPAGE_BPS = 100;

export function buildSwap(
  dep: Deployments,
  q: SwapQuote,
  recipient: `0x${string}`,
  simPrice: bigint,
  deadline: bigint,
): BuiltSwap {
  const tokenIn = q.from === "ETH" ? dep.weth9Sentinel : dep.sUSDC;
  const tokenOut = q.to === "ETH" ? dep.weth9Sentinel : dep.sUSDC;
  const expected = simOut(q.from, q.amountIn, simPrice);
  const minOut = (expected * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n;
  const data = encodeFunctionData({
    abi: SWAP_ABI,
    functionName: "exactInputSingle",
    args: [{
      tokenIn, tokenOut, fee: POOL_FEE, recipient, deadline,
      amountIn: q.amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n,
    }],
  });
  return {
    to: dep.swapSim,
    data,
    value: q.from === "ETH" ? q.amountIn : 0n,
    // Both lines stay inside the pendant's 96 characters.
    human: `Swap ${fmt(q.amountIn, q.from)} for ${fmt(expected, q.to)}`,
    rationale: `${q.route} quotes 1 ETH = ${q.rate.toFixed(2)} USDC on mainnet; executed on the sim.`,
    minOut,
  };
}
