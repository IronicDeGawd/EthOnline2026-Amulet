import { describe, expect, it } from "vitest";
import { fetchHistory, historyLines, tally, type AgentHistory } from "../src/data/graph/history.js";

const NOW = 1_757_000_000_000; // fixed clock so the wording is testable
const secs = NOW / 1000;

function history(recent: AgentHistory["recent"], counts: Partial<AgentHistory> = {}): AgentHistory {
  return {
    label: "repay", requests: recent.length, approved: 0, rejected: 0, refusedByPolicy: 0, expired: 0,
    ...counts, recent,
  };
}

describe("what the agent remembers", () => {
  it("says so plainly when there is nothing", () => {
    expect(historyLines(undefined, NOW)).toContain("never asked this owner for anything");
    expect(historyLines(history([]), NOW)).toContain("never asked");
  });

  it("counts what happened, in the owner's terms", () => {
    const h = history(
      [{ outcome: "approved", value: "2000000000000000", target: "0x1", timestamp: secs - 120 }],
      { requests: 4, approved: 1, rejected: 1, refusedByPolicy: 1, expired: 1 },
    );
    const s = historyLines(h, NOW);
    expect(s).toContain("4 requests");
    expect(s).toContain("1 approved");
    expect(s).toContain("2 refused"); // swiped away plus refused by the device
    expect(s).toContain("1 left unanswered");
  });

  it("describes each past request in words, not codes", () => {
    const h = history([
      { outcome: "policy_reject", value: "20000000000000000", target: "0x1", timestamp: secs - 300 },
      { outcome: "approved", value: "2000000000000000", target: "0x1", timestamp: secs - 7200 },
    ], { requests: 2, approved: 1, refusedByPolicy: 1 });
    const s = historyLines(h, NOW);
    expect(s).toContain("0.02 ETH");
    expect(s).toContain("broke your limits");
    expect(s).toContain("approved it");
    expect(s).toContain("5 minutes ago");
    expect(s).toContain("2 hours ago");
    expect(s).not.toContain("policy_reject");
  });

  it("warns itself off after two recent refusals", () => {
    const h = history([
      { outcome: "policy_reject", value: "20000000000000000", target: "0x1", timestamp: secs - 60 },
      { outcome: "rejected", value: "20000000000000000", target: "0x1", timestamp: secs - 600 },
    ], { requests: 2, rejected: 1, refusedByPolicy: 1 });
    expect(historyLines(h, NOW)).toContain("do not ask for the same thing again");
  });

  it("does not warn after a single refusal", () => {
    const h = history([
      { outcome: "rejected", value: "2000000000000000", target: "0x1", timestamp: secs - 60 },
      { outcome: "approved", value: "2000000000000000", target: "0x1", timestamp: secs - 600 },
    ], { requests: 2, approved: 1, rejected: 1 });
    expect(historyLines(h, NOW)).not.toContain("do not ask for the same thing again");
  });

  it("shows at most five, so the brief cannot be flooded", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ outcome: "approved", value: "1000000000000000", target: "0x1", timestamp: secs - i * 60 }));
    const lines = historyLines(history(many, { requests: 12, approved: 12 }), NOW).split("\n").filter((l) => l.startsWith("  "));
    expect(lines).toHaveLength(5);
  });
});


describe("counting only what this brain wrote", () => {
  it("tallies rows into the buckets the model reads", () => {
    const t = tally("repay", [
      { outcome: "approved", value: "1", target: "0x1", timestamp: 1 },
      { outcome: "policy_reject", value: "1", target: "0x1", timestamp: 2 },
      { outcome: "rejected", value: "1", target: "0x1", timestamp: 3 },
      { outcome: "expired", value: "1", target: "0x1", timestamp: 4 },
      { outcome: "something-else", value: "1", target: "0x1", timestamp: 5 },
    ]);
    expect(t.requests).toBe(5);
    expect(t.approved).toBe(1);
    expect(t.rejected).toBe(1);
    expect(t.refusedByPolicy).toBe(1);
    expect(t.expired).toBe(1);
  });
});

describe("memory is refused without a writer to trust", () => {
  const WRITER = "0x1111111111111111111111111111111111111111" as const;

  it("returns nothing when there is no writing key, and never calls out", async () => {
    let called = false;
    const g = globalThis as { fetch: typeof fetch };
    const real = g.fetch;
    g.fetch = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
    try {
      expect(await fetchHistory("repay", undefined)).toBeUndefined();
      expect(called).toBe(false);
    } finally { g.fetch = real; }
  });

  it("asks the subgraph only for rows that key wrote", async () => {
    let body = "";
    const g = globalThis as { fetch: typeof fetch };
    const real = g.fetch;
    g.fetch = (async (_u: string, init: RequestInit) => {
      body = String(init.body);
      return new Response(JSON.stringify({ data: { actions: [{ outcome: "approved", value: "1000000000000000", target: "0x1", timestamp: 1 }] } }));
    }) as unknown as typeof fetch;
    try {
      const h = await fetchHistory("repay", WRITER);
      expect(body).toContain("sender");
      expect(body).toContain(WRITER.toLowerCase());
      expect(h?.requests).toBe(1);
      expect(h?.approved).toBe(1);
    } finally { g.fetch = real; }
  });

  it("survives a broken answer rather than taking the agent down", async () => {
    const g = globalThis as { fetch: typeof fetch };
    const real = g.fetch;
    for (const answer of ["not json", JSON.stringify({ data: {} }), JSON.stringify({ errors: [{ message: "boom" }] })]) {
      g.fetch = (async () => new Response(answer)) as typeof fetch;
      expect(await fetchHistory("repay", WRITER)).toBeUndefined();
    }
    g.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
    expect(await fetchHistory("repay", WRITER)).toBeUndefined();
    g.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;
    expect(await fetchHistory("repay", WRITER)).toBeUndefined();
    g.fetch = real;
  });
});
