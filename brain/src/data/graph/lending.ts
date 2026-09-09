// One Messari lending-schema query, run against several deployments. Returns the market
// conditions the rules watch (utilization, rates) as a per-protocol table.
import type { GraphClient } from "./client.js";
import type { SubgraphKey } from "../../config.js";

export interface MarketSnapshot {
  protocol: string;
  market: string;
  symbol: string;
  depositUSD: number;
  borrowUSD: number;
  utilization: number; // 0..1
  supplyRateBps: number;
  borrowRateBps: number;
  liquidationThreshold: number; // percent
}

export interface RawMarket {
  id: string;
  name: string;
  inputToken: { symbol: string };
  totalDepositBalanceUSD: string;
  totalBorrowBalanceUSD: string;
  liquidationThreshold: string;
  rates: { side: "LENDER" | "BORROWER"; type: string; rate: string }[];
}

export const LENDING_QUERY = `{
  markets(first: 40, orderBy: totalValueLockedUSD, orderDirection: desc) {
    id name inputToken { symbol } totalDepositBalanceUSD totalBorrowBalanceUSD liquidationThreshold
    rates { side type rate }
  }
}`;

export function toSnapshot(protocol: string, m: RawMarket): MarketSnapshot {
  const dep = Number(m.totalDepositBalanceUSD);
  const bor = Number(m.totalBorrowBalanceUSD);
  const lend = m.rates.find((r) => r.side === "LENDER" && r.type === "VARIABLE");
  const borrow = m.rates.find((r) => r.side === "BORROWER" && r.type === "VARIABLE");
  return {
    protocol,
    market: m.name,
    symbol: m.inputToken.symbol,
    depositUSD: dep,
    borrowUSD: bor,
    utilization: dep > 0 ? bor / dep : 0,
    supplyRateBps: Math.round(Number(lend?.rate ?? 0) * 100),
    borrowRateBps: Math.round(Number(borrow?.rate ?? 0) * 100),
    liquidationThreshold: Number(m.liquidationThreshold),
  };
}

export async function fetchLending(client: GraphClient, key: SubgraphKey) {
  const r = await client.query<{ markets: RawMarket[] }>(key, LENDING_QUERY);
  return { ...r, markets: r.data.markets.map((m) => toSnapshot(key, m)) };
}

export function pickMarket(markets: MarketSnapshot[], symbol: string): MarketSnapshot | undefined {
  return markets.find((m) => m.symbol === symbol);
}
