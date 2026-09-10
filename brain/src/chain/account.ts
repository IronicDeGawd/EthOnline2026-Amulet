// Read-only view of the user's real position on mainnet, found through their ENS name.
// Shown next to the guarded testnet position so the story has a real number in it; the
// brain never builds a transaction against it.
import { parseAbi, type PublicClient } from "viem";
import { normalize } from "viem/ens";
import { AAVE_V3_POOL_MAINNET, MAINNET_VIEW_NAME } from "../config.js";

const POOL_ABI = parseAbi([
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
]);

export interface MainnetView {
  name: string;
  address: `0x${string}`;
  collateralUsd: number;
  debtUsd: number;
  healthFactor: number; // Infinity when there is no debt
  hasPosition: boolean;
}

// Aave's "base" currency is USD with 8 decimals; healthFactor is 1e18-scaled and
// uint256.max when there is no debt.
export function decodeAccountData(name: string, address: `0x${string}`, coll: bigint, debt: bigint, hf: bigint): MainnetView {
  const collateralUsd = Number(coll) / 1e8;
  const debtUsd = Number(debt) / 1e8;
  const healthFactor = debt === 0n ? Infinity : Number(hf) / 1e18;
  return { name, address, collateralUsd, debtUsd, healthFactor, hasPosition: coll > 0n || debt > 0n };
}

export async function readMainnetView(client: PublicClient, name = MAINNET_VIEW_NAME): Promise<MainnetView> {
  const address = await client.getEnsAddress({ name: normalize(name) });
  if (!address) throw new Error(`${name} does not resolve on mainnet`);
  const [coll, debt, , , , hf] = await client.readContract({ address: AAVE_V3_POOL_MAINNET, abi: POOL_ABI, functionName: "getUserAccountData", args: [address] });
  return decodeAccountData(name, address, coll, debt, hf);
}

export function formatView(v: MainnetView): string {
  if (!v.hasPosition) return `mainnet ${v.name} (${v.address.slice(0, 6)}…${v.address.slice(-4)}): no Aave v3 position (read-only)`;
  const hf = Number.isFinite(v.healthFactor) ? v.healthFactor.toFixed(2) : "∞";
  return `mainnet ${v.name}: Aave v3 collateral $${v.collateralUsd.toFixed(2)} debt $${v.debtUsd.toFixed(2)} HF ${hf} (read-only)`;
}
