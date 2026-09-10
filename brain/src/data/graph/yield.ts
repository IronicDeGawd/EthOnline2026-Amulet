// One lending query, three protocols, one ranked table: where does this asset earn the most
// right now? Every row carries its own freshness evidence; a protocol whose subgraph is
// stale or unreachable is left out and said so, never guessed.
import type { PublicClient } from "viem";
import type { GraphClient } from "./client.js";
import { checkFreshness, type Evidence } from "./freshness.js";
import { fetchLending, type MarketSnapshot } from "./lending.js";
import { headBlock } from "../../chain/sepolia.js";
import type { SubgraphKey } from "../../config.js";

export const YIELD_SOURCES: SubgraphKey[] = ["aaveV3", "compoundV3", "spark"];
export const YIELD_ASSET = "WETH";

export interface YieldRow {
  protocol: string; // "Aave" | "Compound" | "Spark"
  market: string;
  symbol: string;
  supplyRateBps: number;
  depositUSD: number;
  evidence: Evidence;
}

export interface YieldTable {
  asset: string;
  rows: YieldRow[]; // best first
  skipped: string[]; // "Compound: stale (lag 9)" …
  head: number;
}

// Compound v3 lists an asset once per comet (as collateral, earning nothing) and once as the
// comet's own base market. Only the base market pays supply interest, so prefer the market
// named after the asset; otherwise the highest-paying entry for that symbol.
export function baseMarket(markets: MarketSnapshot[], symbol: string): MarketSnapshot | undefined {
  const mine = markets.filter((m) => m.symbol === symbol);
  if (!mine.length) return undefined;
  const word = new RegExp(`\\b${symbol}\\b`);
  const named = mine.filter((m) => word.test(m.market.split(" - ")[0])); // "Compound V3 WETH - …", not "Compound V3 USDC - Wrapped Ether"
  return [...(named.length ? named : mine)].sort((a, b) => b.supplyRateBps - a.supplyRateBps)[0];
}

export function rankRows(rows: YieldRow[]): YieldRow[] {
  return [...rows].sort((a, b) => b.supplyRateBps - a.supplyRateBps);
}

// Yearly gas cost of moving, as basis points of the position: a 6.1% venue is not better
// than a 5.9% one when the move itself eats the difference.
export function netBps(row: YieldRow, gasUsd: number, positionUsd: number): number {
  if (positionUsd <= 0) return row.supplyRateBps;
  return Math.round(row.supplyRateBps - (gasUsd / positionUsd) * 10_000);
}

export async function fetchYieldTable(graph: GraphClient, mainnet: PublicClient, asset = YIELD_ASSET): Promise<YieldTable> {
  const head = await headBlock(mainnet);
  const results = await Promise.allSettled(YIELD_SOURCES.map((k) => fetchLending(graph, k)));
  const rows: YieldRow[] = [];
  const skipped: string[] = [];
  results.forEach((r, i) => {
    const key = YIELD_SOURCES[i];
    if (r.status === "rejected") { skipped.push(`${key}: ${(r.reason as Error).message.split("\n")[0]}`); return; }
    const fresh = checkFreshness(key, r.value.meta, head, r.value.queriedAt);
    if (!fresh.ok) { skipped.push(`${key}: ${fresh.reason} (${fresh.detail})`); return; }
    const m = baseMarket(r.value.markets, asset);
    if (!m) { skipped.push(`${key}: no ${asset} market`); return; }
    rows.push({ protocol: m.protocol, market: m.market, symbol: m.symbol, supplyRateBps: m.supplyRateBps, depositUSD: m.depositUSD, evidence: fresh.evidence });
  });
  return { asset, rows: rankRows(rows), skipped, head };
}

export function formatTable(t: YieldTable): string[] {
  const lines = t.rows.map((r, i) =>
    `${String(i + 1).padEnd(2)} ${r.protocol.padEnd(9)} ${r.market.slice(0, 26).padEnd(26)} ${(r.supplyRateBps / 100).toFixed(2).padStart(5)}%  $${(r.depositUSD / 1e6).toFixed(0).padStart(5)}M  ${r.evidence.deploymentId.slice(0, 8)}… block ${r.evidence.block}`,
  );
  for (const s of t.skipped) lines.push(`-- ${s}`);
  return lines;
}
