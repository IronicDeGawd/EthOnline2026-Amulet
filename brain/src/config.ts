// Chain ids, addresses, pinned Graph deployments and rule defaults.
// Policy records on ENS override the thresholds at runtime (engine/policy.ts).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..", "..");

export const SEPOLIA_CHAIN_ID = 11155111;
export const MAINNET_CHAIN_ID = 1;

// Ledger Nano X account the pendant carries (path 44'/60'/0'/0/0). The pendant reports it
// in presence messages; this is the boot default so proposals can be built before that.
export const LEDGER_ADDRESS = "0x211828006b402e0aae8244fB95B362b9eFFf7736" as const;

export interface Deployments {
  chainId: number;
  simA: `0x${string}`;
  simB: `0x${string}`;
  swapSim: `0x${string}`;
  amuletLog: `0x${string}`;
  sUSDC: `0x${string}`;
  weth9Sentinel: `0x${string}`;
  selectors: Record<string, `0x${string}`>;
}

export function loadDeployments(chainId = SEPOLIA_CHAIN_ID): Deployments {
  const p = resolve(REPO_ROOT, "contracts", "deployments", `${chainId}.json`);
  return JSON.parse(readFileSync(p, "utf8")) as Deployments;
}

// Messari-schema subgraphs on The Graph network (mainnet data). Pinned by deployment hash:
// the freshness gate refuses evidence from any other deployment.
export const GRAPH_GATEWAY = "https://gateway.thegraph.com/api";
export const SUBGRAPHS = {
  aaveV3: {
    name: "Aave V3 Ethereum",
    id: "JCNWRypm7FYwV8fx5HhzZPSFaMxgkPuw4TnR3Gpi81zk",
    deployment: "QmcXE5QVcBcvcaJddPxd8mFs6W9xt7STmwfgguoiM6ddAd",
    schema: "lending",
  },
  compoundV3: {
    name: "Compound V3 Ethereum",
    id: "AwoxEZbiWLvv6e3QdvdMZw4WDURdGbvPfHmZRc8Dpfz9",
    deployment: "QmNrQoow7pjM3biRnnhzeCaDYhuEbDyjKCpFeNv2oGXnuK",
    schema: "lending",
  },
  spark: {
    name: "Spark Lend Ethereum",
    id: "GbKdmBe4ycCYCQLQSjqGg6UHYoYfbyJyq5WrG35pv1si",
    deployment: "QmTVumjhubXWP8MeDx5g114MRX99E4Gie5mFqVurttF99X",
    schema: "lending",
  },
  uniswapV3: {
    name: "Uniswap V3 Ethereum",
    id: "4cKy6QQMc5tpfdx8yxfYeb9TLZmgLQe44ddW1G7NwkA6",
    deployment: "Qmc9TiHtLDgsbgqvyfXKiyndZDnjWdrfdvETgarZbg3StY",
    schema: "dex",
  },
} as const;
export type SubgraphKey = keyof typeof SUBGRAPHS;

// Freshness: evidence older than this many mainnet blocks behind head is refused.
export const MAX_BLOCK_LAG = 5;

// Rule defaults. Same names as the ENS text records that override them.
export const DEFAULT_POLICY = {
  version: 1,
  chain: SEPOLIA_CHAIN_ID,
  allowed: [] as { target: `0x${string}`; selectors: `0x${string}`[] }[],
  max_value_wei: 50_000_000_000_000_000n, // 0.05 ETH
  max_token_usd: 200,
  tier1_hf: 1.4,
  tier2_hf: 1.25,
  target_hf: 1.4,
  drift_bps: 1500,
  presence_timeout_s: 120,
  yield_delta_bps: 150,
  util_spike_pts: 10,
  util_window_blocks: 40,
};
export type Policy = typeof DEFAULT_POLICY;

export const TICK_MS = 12_000;
export const PROPOSAL_TTL_S = 600;
export const LLM_TIMEOUT_MS = 4000;
export const NOVA_MODEL = "amazon.nova-lite-v1:0";
export const PENDANT_PORT = 8788;
