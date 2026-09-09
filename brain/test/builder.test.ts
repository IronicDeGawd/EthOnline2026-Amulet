import { describe, expect, it } from "vitest";
import { loadDeployments } from "../src/config.js";
import { exactInputSingleCalldata, repayCalldata, supplyCalldata } from "../src/tx/builder.js";
import { selectorOf } from "../src/engine/policy.js";
import { assemble, proposalIdBytes32 } from "../src/engine/proposal.js";

const dep = loadDeployments();

describe("calldata", () => {
  it("repay/supply match the pinned selectors", () => {
    expect(repayCalldata()).toBe(dep.selectors.repay);
    expect(supplyCalldata()).toBe(dep.selectors.supply);
  });
  it("exactInputSingle has the Uniswap v3 selector and 8 words", () => {
    const d = exactInputSingleCalldata({
      tokenIn: dep.weth9Sentinel, tokenOut: dep.sUSDC, recipient: "0x211828006b402e0aae8244fB95B362b9eFFf7736",
      amountIn: 10_000_000_000_000_000n, amountOutMinimum: 0n, deadline: 1_800_000_000n,
    });
    expect(selectorOf(d)).toBe(dep.selectors.exactInputSingle);
    expect(d.length).toBe(2 + 8 + 8 * 64);
  });
});

describe("proposal JSON matches what proposal.c parses", () => {
  it("hex strings for big numbers, plain numbers for the rest", () => {
    const p = assemble("REPAY_DEBT", 2, { human: "Repay", rationale: "why", source: "template" },
      { to: dep.simA, value: 10_000_000_000_000_000n, data: repayCalldata(), nonce: 13, gas: 70_000, maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_500_000_000n },
      { deploymentId: "Qm", block: 1, queriedAt: 2, subgraph: "x" }, 1000);
    expect(p.type).toBe("proposal");
    expect(p.tx.value).toBe("0x2386f26fc10000");
    expect(p.tx.maxFeePerGas).toBe("0x6fc23ac00");
    expect(typeof p.tx.nonce).toBe("number");
    expect(typeof p.tx.gas).toBe("number");
    expect(p.tx.chainId).toBe(11155111);
    expect(p.expiresAt).toBe(1600);
    expect(p.id).toHaveLength(26);
    expect(proposalIdBytes32(p.id)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
