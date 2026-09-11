// What the account actually holds, read fresh. Four or five short rows: the pendant shows
// them as a list, and everything on it is a number read from chain, never a cached guess.
import { parseAbi, type PublicClient } from "viem";
import { readPosition } from "./positionsim.js";
import type { Deployments } from "../config.js";

const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export interface Holding {
  label: string;  // "ETH", "Sim-A"
  value: string;  // "0.0134"
  sub: string;    // "in the account", "supplied"
}

function eth(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(4).replace(/0+$/, "").replace(/\.$/, "") || "0";
}

export async function readPortfolio(client: PublicClient, dep: Deployments): Promise<Holding[]> {
  const account = dep.amuletAccount!;
  const [bal, usdc, a, b] = await Promise.all([
    client.getBalance({ address: account }),
    client.readContract({ address: dep.sUSDC, abi: ERC20, functionName: "balanceOf", args: [account] }),
    readPosition(client, dep.simA, account),
    readPosition(client, dep.simB, account),
  ]);
  const rows: Holding[] = [
    { label: "ETH", value: eth(bal), sub: "in the account" },
    { label: "sUSDC", value: (Number(usdc) / 1e6).toFixed(2), sub: "in the account" },
  ];
  // A market with nothing in it is not worth a row on a 32 mm screen.
  for (const p of [a, b]) {
    if (p.collateralWei > 0n) rows.push({ label: p.name, value: `${eth(p.collateralWei)} ETH`, sub: "supplied" });
    if (p.debtUnits > 0n) {
      // "Owed", not "Sim-A debt": the label column is 76 px and the market belongs on the
      // second line anyway, next to the number that says whether it is comfortable.
      rows.push({
        label: "Owed",
        value: `$${(Number(p.debtUnits) / 1e6).toFixed(2)}`,
        sub: Number.isFinite(p.healthFactor) ? `${p.name} health ${p.healthFactor.toFixed(2)}` : p.name,
      });
    }
  }
  return rows;
}

export function portfolioMessage(rows: Holding[]): { type: "portfolio"; rows: Holding[] } {
  return { type: "portfolio", rows: rows.slice(0, 8) };
}
