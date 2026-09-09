// Read-only clients. The brain holds no key that can touch the guarded position; the only
// key it ever loads is the log hot key, which can do nothing else.
import { createPublicClient, http, type PublicClient } from "viem";
import { mainnet, sepolia } from "viem/chains";

export function sepoliaClient(rpcUrl: string): PublicClient {
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl, { timeout: 15_000 }) });
}

export function mainnetClient(rpcUrl: string): PublicClient {
  return createPublicClient({ chain: mainnet, transport: http(rpcUrl, { timeout: 15_000 }) });
}

export async function headBlock(client: PublicClient): Promise<number> {
  return Number(await client.getBlockNumber());
}

export interface FeeQuote { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }

export async function feeQuote(client: PublicClient): Promise<FeeQuote> {
  const block = await client.getBlock();
  const base = block.baseFeePerGas ?? 1_000_000_000n;
  let tip = 1_500_000_000n;
  try { tip = await client.estimateMaxPriorityFeePerGas(); } catch { /* keep default */ }
  if (tip === 0n) tip = 1_500_000_000n;
  return { maxFeePerGas: 2n * base + tip, maxPriorityFeePerGas: tip };
}
