// Unsigned EIP-1559 transactions for the pendant to carry to the Ledger. Calldata is
// encoded from the ABIs; nonce and fees are read live; gas is estimated with headroom.
import { encodeFunctionData, parseAbi, type PublicClient } from "viem";
import { POSITION_SIM_ABI } from "../chain/positionsim.js";
import { feeQuote } from "../chain/sepolia.js";
import type { BuiltTx } from "../engine/proposal.js";

export const SWAP_SIM_ABI = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);

export function repayCalldata(): `0x${string}` {
  return encodeFunctionData({ abi: POSITION_SIM_ABI, functionName: "repay" });
}

export function supplyCalldata(): `0x${string}` {
  return encodeFunctionData({ abi: POSITION_SIM_ABI, functionName: "supply" });
}

export interface SwapParams {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  recipient: `0x${string}`;
  amountIn: bigint;
  amountOutMinimum: bigint;
  deadline: bigint;
  fee?: number;
}

export function exactInputSingleCalldata(p: SwapParams): `0x${string}` {
  return encodeFunctionData({
    abi: SWAP_SIM_ABI,
    functionName: "exactInputSingle",
    args: [{
      tokenIn: p.tokenIn, tokenOut: p.tokenOut, fee: p.fee ?? 3000, recipient: p.recipient,
      deadline: p.deadline, amountIn: p.amountIn, amountOutMinimum: p.amountOutMinimum, sqrtPriceLimitX96: 0n,
    }],
  });
}

export interface Call { to: `0x${string}`; value: bigint; data: `0x${string}`; from: `0x${string}` }

// Fills in nonce, fees and gas for a call. Gas estimate ×1.3, with a floor of 60k for
// contract calls so a slightly changed state does not strand a signed transaction.
export async function buildTx(client: PublicClient, call: Call, gasOverride?: number): Promise<BuiltTx> {
  const [nonce, fees] = await Promise.all([
    client.getTransactionCount({ address: call.from, blockTag: "pending" }),
    feeQuote(client),
  ]);
  let gas = gasOverride ?? 0;
  if (!gas) {
    try {
      const est = await client.estimateGas({ account: call.from, to: call.to, value: call.value, data: call.data });
      gas = Math.ceil(Number(est) * 1.3);
    } catch (e) {
      throw new Error(`gas estimate failed (the call would revert?): ${(e as Error).message.split("\n")[0]}`);
    }
    if (call.data !== "0x" && gas < 60_000) gas = 60_000;
  }
  return { to: call.to, value: call.value, data: call.data, nonce, gas, ...fees };
}
