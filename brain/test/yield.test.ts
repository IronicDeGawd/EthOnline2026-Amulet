import { describe, expect, it } from "vitest";
import { baseMarket, netBps, rankRows, type YieldRow } from "../src/data/graph/yield.js";
import { toSnapshot, type MarketSnapshot, type RawMarket } from "../src/data/graph/lending.js";

const snap = (protocol: string, market: string, symbol: string, supplyRateBps: number, depositUSD = 1e8): MarketSnapshot => ({
  protocol, market, symbol, depositUSD, borrowUSD: 0, utilization: 0, supplyRateBps, borrowRateBps: 0, liquidationThreshold: 80,
});
const ev = { deploymentId: "Qm", block: 1, queriedAt: 0, subgraph: "x" };
const row = (protocol: string, supplyRateBps: number, depositUSD = 1e8): YieldRow => ({ protocol, market: `${protocol} WETH`, symbol: "WETH", supplyRateBps, depositUSD, evidence: ev });

describe("baseMarket", () => {
  it("prefers the comet's own market over the same asset listed as collateral elsewhere", () => {
    const markets = [
      snap("Compound", "Compound V3 USDC - Wrapped Ether", "WETH", 0),
      snap("Compound", "Compound V3 WETH - Wrapped Ether", "WETH", 135),
      snap("Compound", "Compound V3 USDT - Wrapped Ether", "WETH", 0),
    ];
    expect(baseMarket(markets, "WETH")?.market).toBe("Compound V3 WETH - Wrapped Ether");
  });
  it("falls back to the best-paying entry when no name carries the symbol", () => {
    const markets = [snap("X", "pool a", "WETH", 10), snap("X", "pool b", "WETH", 40)];
    expect(baseMarket(markets, "WETH")?.supplyRateBps).toBe(40);
  });
  it("is undefined for an asset the protocol does not list", () => {
    expect(baseMarket([snap("Aave", "Aave Ethereum USDC", "USDC", 371)], "WETH")).toBeUndefined();
  });
});

describe("ranking", () => {
  it("best first", () => {
    const r = rankRows([row("Aave", 147), row("Spark", 397), row("Compound", 135)]);
    expect(r.map((x) => x.protocol)).toEqual(["Spark", "Aave", "Compound"]);
  });
  it("net after gas can reorder a thin lead", () => {
    // 6.10% vs 5.90% on a $1,000 position: a $3 move costs 30 bps a year.
    expect(netBps(row("Spark", 610), 3, 1000)).toBe(580);
    expect(netBps(row("Aave", 590), 0, 1000)).toBe(590);
    expect(netBps(row("Spark", 610), 3, 0)).toBe(610);
  });
});

describe("lending snapshot", () => {
  it("names a market when the subgraph leaves the name null", () => {
    const raw: RawMarket = { id: "0x1", name: null, inputToken: { symbol: "WETH" }, totalDepositBalanceUSD: "1", totalBorrowBalanceUSD: "0", liquidationThreshold: "80", rates: [] };
    expect(toSnapshot("Spark", raw).market).toBe("Spark WETH");
  });
});
