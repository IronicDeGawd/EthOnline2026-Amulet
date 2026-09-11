// Records every pendant decision on AmuletLog from the brain's log hot key. That key can
// write this one event and nothing else of value; the subgraph indexes it.
import { createWalletClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

export const AMULET_LOG_ABI = parseAbi([
  "function record(bytes32 proposalId, string agent, address target, uint256 value, bytes4 selector, uint8 tier, uint8 outcome)",
  "event Action(address indexed sender, bytes32 indexed proposalId, address indexed target, string agent, uint256 value, bytes4 selector, uint8 tier, uint8 outcome, uint256 blockNumber)",
]);

export const OUTCOME = { approved: 0, rejected: 1, policy_reject: 2, expired: 3 } as const;
export type Outcome = keyof typeof OUTCOME;

export interface LogEntry {
  proposalId: Hex; // bytes32
  agent: string;   // the ENS label the request claimed; empty when it claimed none
  target: `0x${string}`;
  value: bigint;
  selector: Hex; // bytes4
  tier: number;
  outcome: Outcome;
}

export interface Recorder {
  address: `0x${string}`;
  record(e: LogEntry): Promise<Hex>;
}

export function makeRecorder(rpcUrl: string, pk: Hex, logAddress: `0x${string}`): Recorder {
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl, { timeout: 20_000 }) });
  return {
    address: account.address,
    record: (e) =>
      wallet.writeContract({
        address: logAddress,
        abi: AMULET_LOG_ABI,
        functionName: "record",
        args: [e.proposalId, e.agent, e.target, e.value, e.selector, e.tier, OUTCOME[e.outcome]],
      }),
  };
}
