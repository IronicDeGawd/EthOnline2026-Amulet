// Chain ids, addresses, pinned Graph deployments and rule defaults.
// Policy records on ENS override the thresholds at runtime (engine/policy.ts).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..", "..");

export const SEPOLIA_CHAIN_ID = 11155111;
// How long to wait for a Sepolia receipt before giving up. Unbounded waits are how a demo
// wedges: a dropped or underpriced transaction never mines and the key you pressed never
// finishes, so the next key is refused as "still on that one".
export const RECEIPT_TIMEOUT_MS = 120_000;
export const MAINNET_CHAIN_ID = 1;

// Ledger Nano X account the pendant carries (path 44'/60'/0'/0/0). The pendant reports it
// in presence messages; this is the boot default so proposals can be built before that.
export const LEDGER_ADDRESS = "0x211828006b402e0aae8244fB95B362b9eFFf7736" as const;

export interface Deployments {
  chainId: number;
  amuletAccount?: `0x${string}`;
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

// ENSv2 Sepolia beta (contracts-v2 @ 97a5729). The policy lives as text records on
// guardian.<parent>.eth; the brain reads through the Universal Resolver, the pendant reads
// the resolver proxy directly. Per-name addresses land in contracts/deployments/ens-<chain>.json.
export const ENS = {
  chainId: SEPOLIA_CHAIN_ID,
  parentLabel: "amuletguard",
  childLabel: "guardian",
  rootRegistry: "0x8115186e8f2e0b0281e86ab91f0f48ba90364354",
  ethRegistry: "0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2",
  ethRegistrar: "0xa88553f454b77203b0d036a05c894d555eaaa2cc",
  factory: "0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef",
  resolverImpl: "0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e",
  userRegistryImpl: "0x624a25d67b59d587752ebec8dded8827dae52050",
  universalResolver: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
  mockUsdc: "0x768f42455a2d082e23ceef7d51e5787c82d67a39",
  commit: "97a57293f3b4279d94b571e678edb53ce62638f4",
} as const;
export const POLICY_NAME = `${ENS.childLabel}.${ENS.parentLabel}.eth`;
export const POLICY_KEYS = [
  "amulet.version", "amulet.chain", "amulet.allowed", "amulet.max_value_wei", "amulet.max_token_usd",
  "amulet.tier1_hf", "amulet.tier2_hf", "amulet.drift_bps", "amulet.presence_timeout_s", "amulet.yield_delta_bps",
] as const;
export const STATUS_KEYS = ["amulet.status", "amulet.last-action"] as const;

// One agent, one name. Each agent the brain can run as is a subname of the parent with its
// own policy records and its own avatar, so the wrist can see which of them is asking and
// each one is held to its own limits. An agent with no name is refused outright.
// Each one is held to different limits on purpose: the repay agent may touch the market the
// position lives in, the yield scout may only move a small slice into the second market. The
// limits are records on that agent's own name, so the Ledger can loosen one without loosening
// the other, and can let one lapse without touching the other.
export const AGENTS = {
  repay: {
    label: "repay",
    title: "Repay bot",
    caps: { max_value_wei: 50_000_000_000_000_000n, targets: ["simA"] as const, selectors: ["repay", "supply"] as const },
    // What the model is told it is for. One agent, one job, one leash.
    mandate: "You are a cautious guardian. Your only concern is that this position never gets liquidated. You do not chase yield.",
  },
  swap: {
    label: "swap",
    title: "Swap desk",
    caps: { max_value_wei: 20_000_000_000_000_000n, targets: ["swapSim"] as const, selectors: ["exactInputSingle"] as const },
    mandate: "You are a swap desk. You do not act on your own — you answer when your owner asks for a pair, find the best route, and propose it.",
  },
  yield: {
    label: "yield",
    title: "Yield scout",
    caps: { max_value_wei: 10_000_000_000_000_000n, targets: ["simB"] as const, selectors: ["supply"] as const },
    mandate: "You are a yield scout. You look for a better rate for the same asset and move only when the gain clearly beats the cost of interrupting your owner.",
  },
} as const;
export type AgentKey = keyof typeof AGENTS;
export const DEFAULT_AGENT: AgentKey = "repay";
export const agentName = (a: string): string => `${a}.${ENS.parentLabel}.eth`;
export const AVATAR_KEY = "avatar";
// The face the pendant draws, square, 16-bit colour. Small on purpose: it travels in one
// websocket message and lives in the pendant's memory beside the policy.
export const AVATAR_PX = 32;

export interface EnsDeployment {
  chainId: number;
  name: string;
  node: `0x${string}`;
  parent: string;
  resolver: `0x${string}`;
  subregistry: `0x${string}` | null;
  ledger: `0x${string}`;
  brain: `0x${string}`;
  deployer: `0x${string}`;
  expiry: number;
  commit: string;
}

export function loadEnsDeployment(chainId = SEPOLIA_CHAIN_ID): EnsDeployment {
  const p = resolve(REPO_ROOT, "contracts", "deployments", `ens-${chainId}.json`);
  return JSON.parse(readFileSync(p, "utf8")) as EnsDeployment;
}

// What the sims are called on every screen. The contracts are named "Sim-A" and "Sim-B" on
// chain and that cannot change without a redeploy; but the wearer should read the venue each
// one stands in for. One table, used wherever a sentence is built.
export const SIM_DISPLAY: Record<string, string> = {
  "Sim-A": "Aave (sim)",
  "Sim-B": "Spark (sim)",
};
export const simDisplay = (onChainName: string): string => SIM_DISPLAY[onChainName] ?? onChainName;
// The holdings screen has a 76 px label column: the venue alone, no "(sim)".
export const SIM_SHORT: Record<string, string> = { "Aave (sim)": "Aave", "Spark (sim)": "Spark" };
export const simShort = (displayName: string): string => SIM_SHORT[displayName] ?? displayName;
export const simLabel = (which: "simA" | "simB"): string => (which === "simB" ? SIM_DISPLAY["Sim-B"] : SIM_DISPLAY["Sim-A"]);

export const POLICY_REFRESH_TICKS = 10;

// Typed-data signing: the Ledger reads an EIP-712 intent, so the device shows the sentence
// instead of blind bytes. Off by default; --clear turns it on.
export const INTENT_TTL_S = 900;

// Yield card: re-rank venues every few ticks; the spread must hold this many mainnet
// blocks before a card goes out; a dismissed card stays quiet for an hour.
export const YIELD_TICKS = 5;
export const YIELD_HOLD_BLOCKS = 20;
export const RULE_COOLDOWN_MS: Record<string, number> = { YIELD_OPP: 3_600_000 };
export const DEFAULT_COOLDOWN_MS = 60_000;

// Mainnet read-only view: the user's real position, resolved from their ENS name. Shown,
// never acted on.
export const MAINNET_VIEW_NAME = "ironyaditya.eth";
export const AAVE_V3_POOL_MAINNET = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2" as const;

export const TICK_MS = 12_000;
export const PROPOSAL_TTL_S = 600;
export const LLM_TIMEOUT_MS = 4000;
export const NOVA_MODEL = "amazon.nova-pro-v1:0";
export const PENDANT_PORT = 8788;
