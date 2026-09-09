// The proposal JSON exactly as firmware/main/proposal.c parses it. Big integers travel as
// hex strings; nonce, gas, tier, block and expiresAt as plain numbers.
import { keccak256, toHex, type Hex } from "viem";
import { ulid } from "ulid";
import { PROPOSAL_TTL_S, SEPOLIA_CHAIN_ID } from "../config.js";
import type { Evidence } from "../data/graph/freshness.js";
import type { Action } from "./rules.js";
import type { Tier } from "./tiers.js";
import type { Explanation } from "./llm.js";

export interface ProposalTx {
  chainId: number;
  to: `0x${string}`;
  value: `0x${string}`;
  data: `0x${string}`;
  nonce: number;
  maxFeePerGas: `0x${string}`;
  maxPriorityFeePerGas: `0x${string}`;
  gas: number;
}

export interface Proposal {
  type: "proposal";
  id: string;
  tier: Tier;
  action: Action;
  human: string;
  rationale: string;
  tx: ProposalTx;
  evidence: Evidence;
  expiresAt: number;
}

export interface BuiltTx {
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
  nonce: number;
  gas: number;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export function assemble(
  action: Action,
  tier: Tier,
  text: Explanation,
  tx: BuiltTx,
  evidence: Evidence,
  now = Math.floor(Date.now() / 1000),
): Proposal {
  return {
    type: "proposal",
    id: ulid(),
    tier,
    action,
    human: text.human,
    rationale: text.rationale,
    tx: {
      chainId: SEPOLIA_CHAIN_ID,
      to: tx.to,
      value: toHex(tx.value),
      data: tx.data,
      nonce: tx.nonce,
      maxFeePerGas: toHex(tx.maxFeePerGas),
      maxPriorityFeePerGas: toHex(tx.maxPriorityFeePerGas),
      gas: tx.gas,
    },
    evidence,
    expiresAt: now + PROPOSAL_TTL_S,
  };
}

// bytes32 id for AmuletLog.record: keccak of the ulid string.
export function proposalIdBytes32(id: string): Hex {
  return keccak256(toHex(id));
}
