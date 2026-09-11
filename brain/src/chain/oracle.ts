// The real price of ETH, from Chainlink's own feed on Sepolia.
//
// The sim's price used to be whatever we typed into setPrice, which makes every health factor
// in the demo an opinion rather than a fact. This reads the feed the rest of DeFi reads, in
// the same 8-decimal scale PositionSim already uses, so the position can be made to track the
// real market and the agent is reasoning about a real move.
import { parseAbi, type PublicClient, type WalletClient, type Account } from "viem";
import { sepolia } from "viem/chains";

// Chainlink ETH/USD, Sepolia. https://docs.chain.link/data-feeds/price-feeds/addresses
export const ETH_USD_SEPOLIA = "0x694AA1769357215DE4FAC081bf1f309aDC325306" as const;

export const FEED_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
]);

// A testnet feed updates far less often than mainnet; an hour is normal, a day is not.
export const MAX_FEED_AGE_S = 24 * 3600;

export interface Quote {
  price: bigint;      // 8 decimals, the scale PositionSim speaks
  updatedAt: number;  // unix seconds
  ageS: number;
  stale: boolean;
  description: string;
  feed: `0x${string}`;
}

export async function readEthUsd(client: PublicClient, feed: `0x${string}` = ETH_USD_SEPOLIA, now = Date.now()): Promise<Quote> {
  const [round, decimals, description] = await Promise.all([
    client.readContract({ address: feed, abi: FEED_ABI, functionName: "latestRoundData" }),
    client.readContract({ address: feed, abi: FEED_ABI, functionName: "decimals" }),
    client.readContract({ address: feed, abi: FEED_ABI, functionName: "description" }),
  ]);
  const answer = round[1];
  if (answer <= 0n) throw new Error(`${description} answered ${answer}`);
  // Everything downstream is 8-decimal; a feed with another scale is converted, not assumed.
  const price = scaleTo8(answer, Number(decimals));
  const updatedAt = Number(round[3]);
  const ageS = Math.max(0, Math.floor(now / 1000) - updatedAt);
  return { price, updatedAt, ageS, stale: ageS > MAX_FEED_AGE_S, description, feed };
}

export function scaleTo8(answer: bigint, decimals: number): bigint {
  if (decimals === 8) return answer;
  if (decimals > 8) return answer / 10n ** BigInt(decimals - 8);
  return answer * 10n ** BigInt(8 - decimals);
}

export function formatQuote(q: Quote): string {
  const usd = (Number(q.price) / 1e8).toFixed(2);
  const age = q.ageS < 120 ? `${q.ageS}s` : q.ageS < 7200 ? `${Math.round(q.ageS / 60)}m` : `${Math.round(q.ageS / 3600)}h`;
  return `${q.description} $${usd} (updated ${age} ago${q.stale ? ", STALE" : ""}) from ${q.feed.slice(0, 10)}…`;
}

// Points the sim at the real price. The sim is still a sim — but its price is no longer ours.
export async function syncSimPrice(
  wallet: WalletClient, account: Account, sim: `0x${string}`, price: bigint,
): Promise<`0x${string}`> {
  return wallet.writeContract({
    address: sim, abi: parseAbi(["function setPrice(uint256)"]), functionName: "setPrice",
    args: [price], account, chain: sepolia,
  });
}
