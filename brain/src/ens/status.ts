// The brain's only writes to ENS: amulet.status and amulet.last-action, signed by the hot
// key that holds exactly those two record permissions. Writes are deduplicated so a quiet
// loop costs nothing, and a failure is logged rather than fatal — the pendant does not
// depend on them.
import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { RESOLVER_ABI } from "./abi.js";

export type BrainStatus = "watching" | "proposing" | "stale" | "offline";

export interface StatusWriter {
  address: `0x${string}`;
  setStatus(state: BrainStatus): Promise<Hex | undefined>;
  setLastAction(txHash: string, block: bigint | number): Promise<Hex | undefined>;
}

export interface StatusDeps {
  rpcUrl: string;
  pk: Hex;
  resolver: `0x${string}`;
  node: Hex;
  log: (line: string) => void;
}

export function makeStatusWriter(d: StatusDeps): StatusWriter {
  const account = privateKeyToAccount(d.pk);
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(d.rpcUrl, { timeout: 20_000 }) });
  const last = new Map<string, string>();

  async function write(key: string, value: string): Promise<Hex | undefined> {
    if (last.get(key) === value) return undefined;
    last.set(key, value); // set first: a failing record is not retried every tick
    try {
      const hash = await wallet.writeContract({ address: d.resolver, abi: RESOLVER_ABI, functionName: "setText", args: [d.node, key, value] });
      d.log(`ENS ${key} = ${value} → ${hash}`);
      return hash;
    } catch (e) {
      d.log(`ENS ${key} write failed: ${(e as Error).message.split("\n")[0]}`);
      return undefined;
    }
  }

  return {
    address: account.address,
    setStatus: (state) => write("amulet.status", state),
    setLastAction: (txHash, block) => write("amulet.last-action", `${txHash}@${block}`),
  };
}

// Pure: what the dedup does, for the test.
export function shouldWrite(last: Map<string, string>, key: string, value: string): boolean {
  return last.get(key) !== value;
}
