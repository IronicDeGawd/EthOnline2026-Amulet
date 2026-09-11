// The typed-data path. The pendant builds the intent and the Ledger signs it; the brain only
// carries the signature to the chain and pays the gas. It cannot alter a word of what was
// signed: the summary, the action, the market, the amount, the nonce and the deadline are all
// inside the digest AmuletAccount checks.
import { createWalletClient, http, parseAbi, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

export const ACCOUNT_ABI = parseAbi([
  "function owner() view returns (address)",
  "function nonce() view returns (uint256)",
  "function domainSeparator() view returns (bytes32)",
  "function digest(string summary, string action, address market, uint256 amount, uint256 nonce, uint256 deadline) view returns (bytes32)",
  "function execute(string summary, string action, address market, uint256 amount, uint256 deadline, bytes signature)",
  "function sweep(address to)",
  "event Executed(address indexed market, string action, uint256 amount, uint256 nonce)",
]);

// What the pendant needs to build the same message the contract will hash.
export interface Intent {
  summary: string;
  action: "Supply" | "Repay" | "Withdraw" | "Borrow" | "Swap" | "Sell";
  market: `0x${string}`;
  amount: `0x${string}`; // hex, as the firmware parses it
  nonce: `0x${string}`;
  deadline: `0x${string}`;
  account: `0x${string}`;
}

export async function accountNonce(client: PublicClient, account: `0x${string}`): Promise<bigint> {
  return client.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "nonce" });
}

export async function accountBalance(client: PublicClient, account: `0x${string}`): Promise<bigint> {
  return client.getBalance({ address: account });
}

// The action names the account understands, from the rule that fired.
export function actionName(action: string): Intent["action"] | undefined {
  if (action === "REPAY_DEBT") return "Repay";
  if (action === "ADD_COLLATERAL" || action === "MOVE_SUPPLY") return "Supply";
  if (action === "SWAP") return "Swap";
  return undefined;
}

export interface Relayer {
  address: `0x${string}`;
  relay(i: Intent, signature: Hex): Promise<Hex>;
}

export function makeRelayer(rpcUrl: string, pk: Hex): Relayer {
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl, { timeout: 20_000 }) });
  return {
    address: account.address,
    relay: (i, signature) =>
      wallet.writeContract({
        address: i.account, abi: ACCOUNT_ABI, functionName: "execute",
        args: [i.summary, i.action, i.market, BigInt(i.amount), BigInt(i.deadline), signature],
      }),
  };
}
