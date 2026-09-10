// The compromised brain: what it builds, what its own policy stage would have said, and
// that the wrist's answer is logged and recorded without the brain doing anything else.
import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { buildAttack, runAttack, selfVerdict } from "../src/attack.js";
import { defaultPolicy, withinPolicy } from "../src/engine/policy.js";
import { loadDeployments } from "../src/config.js";
import type { LogEntry } from "../src/chain/amuletlog.js";
import type { Decision } from "../src/pendant/ws.js";

const dep = loadDeployments();
const policy = defaultPolicy(dep);
const LEDGER = "0x211828006b402e0aae8244fB95B362b9eFFf7736" as const;
const DEAD = "0x000000000000000000000000000000000000dEaD" as const;

const sepolia = {
  async getTransactionCount() { return 21; },
  async getBlock() { return { baseFeePerGas: 1_000_000_000n }; },
  async estimateMaxPriorityFeePerGas() { return 1_000_000_000n; },
  async estimateGas() { throw new Error("must not be called: the Ledger cannot pay 5 ETH"); },
} as unknown as PublicClient;

describe("buildAttack", () => {
  it("value: an allowed call carrying far more ETH than the cap, gas not estimated", async () => {
    const b = await buildAttack(sepolia, dep, LEDGER, { kind: "value", eth: "5" });
    expect(b.tx.to).toBe(dep.simA);
    expect(b.tx.data).toBe(dep.selectors.supply);
    expect(b.tx.value).toBe(5_000_000_000_000_000_000n);
    expect(b.tx.gas).toBe(80_000);
    expect(b.tx.nonce).toBe(21);
    expect(b.human).toMatch(/^Add 5 ETH collateral on Sim-A$/);
    const v = withinPolicy({ chainId: dep.chainId, to: b.tx.to, value: b.tx.value, data: b.tx.data, gas: b.tx.gas, expiresAt: 4e9 }, policy);
    expect(v).toEqual({ ok: false, reason: expect.stringMatching(/exceeds cap/) });
  });

  it("target: a small plain transfer to an address the policy never listed", async () => {
    const b = await buildAttack(sepolia, dep, LEDGER, { kind: "target", to: DEAD });
    expect(b.tx.to).toBe(DEAD);
    expect(b.tx.data).toBe("0x");
    expect(b.tx.gas).toBe(21_000);
    expect(b.human).toMatch(/^Send 0.001 ETH to 0x0000…dEaD$/);
    expect(selfVerdict(b.tx, dep.chainId, policy)).toMatch(/^out of policy: target/);
  });

  it("selfVerdict says so loudly when an attack would slip through", () => {
    const tx = { to: dep.simA, value: 1n, data: dep.selectors.repay, nonce: 0, gas: 60_000, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n };
    expect(selfVerdict(tx, dep.chainId, policy)).toMatch(/would not be refused/);
  });
});

describe("runAttack", () => {
  function fakes(result: Decision["result"]) {
    const log: string[] = [];
    const pushed: unknown[] = [];
    const recorded: LogEntry[] = [];
    const pendant = {
      push(p: unknown) { pushed.push(p); return true; },
      async awaitDecision(id: string): Promise<Decision> { return { type: "decision", id, result }; },
    };
    const recorder = { address: LEDGER, async record(e: LogEntry) { recorded.push(e); return "0xhash" as const; } };
    return { log, pushed, recorded, pendant, recorder };
  }

  it("pushes a tier-2 proposal, takes the wrist's answer, records it", async () => {
    const f = fakes("policy_reject");
    const p = await runAttack({ sepolia, dep, policy, ledger: LEDGER, pendant: f.pendant as never, recorder: f.recorder, log: (l) => f.log.push(l) }, { kind: "value", eth: "5" });
    expect(p.tier).toBe(2);
    expect(p.action).toBe("ADD_COLLATERAL");
    expect(p.evidence.deploymentId).toBe("manual");
    expect(p.tx.value).toBe("0x4563918244f40000");
    expect(f.pushed).toEqual([p]);
    expect(f.recorded).toHaveLength(1);
    expect(f.recorded[0].outcome).toBe("policy_reject");
    expect(f.recorded[0].tier).toBe(2);
    expect(f.recorded[0].selector).toBe(dep.selectors.supply);
    expect(f.log.join("\n")).toMatch(/own policy stage skipped; it would have said: out of policy/);
    expect(f.log.join("\n")).toMatch(/DECISION .* policy_reject/);
  });

  it("stops when no pendant is listening", async () => {
    const f = fakes("policy_reject");
    const pendant = { ...f.pendant, push: () => false };
    await expect(runAttack({ sepolia, dep, policy, ledger: LEDGER, pendant: pendant as never, log: () => {} }, { kind: "target", to: DEAD })).rejects.toThrow(/pendant not connected/);
  });

  it("a recorder failure is logged, not thrown", async () => {
    const f = fakes("rejected");
    const recorder = { address: LEDGER, async record(): Promise<`0x${string}`> { throw new Error("out of gas"); } };
    await runAttack({ sepolia, dep, policy, ledger: LEDGER, pendant: f.pendant as never, recorder, log: (l) => f.log.push(l) }, { kind: "target", to: DEAD });
    expect(f.log.join("\n")).toMatch(/AmuletLog.record failed: out of gas/);
  });
});
