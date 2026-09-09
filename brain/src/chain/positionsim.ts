// Reads of the guarded position on PositionSim (Sepolia), plus the pure HF math the
// rules use to size an action. Mirrors PositionSim.sol exactly.
import { parseAbi, type PublicClient } from "viem";

export const POSITION_SIM_ABI = parseAbi([
  "function supply() payable",
  "function withdraw(uint256 amount)",
  "function borrow(uint256 amount)",
  "function repay() payable",
  "function setPrice(uint256 newPrice)",
  "function collateral(address) view returns (uint256)",
  "function debt(address) view returns (uint256)",
  "function price() view returns (uint256)",
  "function liquidationThresholdBps() view returns (uint16)",
  "function healthFactor(address user) view returns (uint256)",
  "function name() view returns (string)",
]);

export interface Position {
  sim: `0x${string}`;
  name: string;
  user: `0x${string}`;
  collateralWei: bigint;
  debtUnits: bigint; // sUSDC, 6 decimals
  price: bigint; // 8 decimals
  ltBps: number;
  healthFactor: number; // Infinity when there is no debt
}

export async function readPosition(client: PublicClient, sim: `0x${string}`, user: `0x${string}`): Promise<Position> {
  const c = { address: sim, abi: POSITION_SIM_ABI } as const;
  const [name, collateralWei, debtUnits, price, ltBps] = await Promise.all([
    client.readContract({ ...c, functionName: "name" }),
    client.readContract({ ...c, functionName: "collateral", args: [user] }),
    client.readContract({ ...c, functionName: "debt", args: [user] }),
    client.readContract({ ...c, functionName: "price" }),
    client.readContract({ ...c, functionName: "liquidationThresholdBps" }),
  ]);
  return {
    sim, name, user, collateralWei, debtUnits, price, ltBps: Number(ltBps),
    healthFactor: healthFactorOf(collateralWei, price, Number(ltBps), debtUnits),
  };
}

// collateral(wei) * price(1e8) * LT(bps) / (debt(1e6) * 1e6) -> 1e18 fixed point.
// (wei 1e18 × price 1e8 × bps 1e4 = 1e30; ÷ debt 1e6 ÷ 1e6 = 1e18.)
export function healthFactorOf(collateralWei: bigint, price: bigint, ltBps: number, debtUnits: bigint): number {
  if (debtUnits === 0n) return Infinity;
  const hf1e18 = (collateralWei * price * BigInt(ltBps)) / (debtUnits * 1_000_000n);
  return Number(hf1e18) / 1e18;
}

export function ethToDebtUnits(wei: bigint, price: bigint): bigint {
  return (wei * price) / 10n ** 20n;
}

export function debtUnitsToWei(units: bigint, price: bigint): bigint {
  return (units * 10n ** 20n) / price;
}
