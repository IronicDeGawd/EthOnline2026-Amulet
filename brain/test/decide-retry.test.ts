import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../src/config.js";
import { deciderFrom, type Turn } from "../src/engine/decide.js";
import { healthFactorOf, type Position } from "../src/chain/positionsim.js";
import type { MarketContext } from "../src/engine/rules.js";

// The one part of the brain that talks to Bedrock. What matters is not the network call but
// what it does with a bad answer: it may argue back exactly once, and it must never throw out
// of the tick — a decider that raises takes the whole agent down with it.

const SIM = "0x9A6c374822AdA7AAA0590f1CE345a4FD949A467c" as const;
const USER = "0x211828006b402e0aae8244fB95B362b9eFFf7736" as const;

function position(): Position {
  const collateralWei = 50_000_000_000_000_000n, price = 1600_00000000n, debtUnits = 60_000_000n;
  return { sim: SIM, name: "Sim-A", user: USER, collateralWei, debtUnits, price, ltBps: 8000,
           healthFactor: healthFactorOf(collateralWei, price, 8000, debtUnits) };
}
const market: MarketContext = {};
const policy = { ...DEFAULT_POLICY, max_value_wei: 10_000_000_000_000_000n };   // 0.01 ETH

const inside = '{"act": true, "action": "REPAY_DEBT", "market": "Sim-A", "amountEth": "0.004", "why": "health factor is low"}';
const overCap = '{"act": true, "action": "REPAY_DEBT", "market": "Sim-A", "amountEth": "5", "why": "clear it all"}';
const standDown = '{"act": false, "why": "the position is comfortable"}';

/* A fake model: hands back the next scripted answer and records what it was asked. */
function scripted(...answers: (string | Error)[]) {
  const seen: Turn[][] = [];
  let i = 0;
  const ask = async (_system: string, messages: Turn[]) => {
    seen.push(messages.map((m) => ({ role: m.role, content: m.content.map((c) => ({ text: c.text })) })));
    const a = answers[i++];
    if (a instanceof Error) throw a;
    if (a === undefined) throw new Error("the decider asked more times than the test allows");
    return a;
  };
  return { ask, seen, calls: () => i };
}

const run = (s: ReturnType<typeof scripted>) =>
  deciderFrom(s.ask).decide(position(), market, policy, "guard the position");

describe("the decider's one retry", () => {
  it("takes a good first answer and does not ask again", async () => {
    const s = scripted(inside);
    const j = await run(s);

    expect(s.calls()).toBe(1);
    expect(j.attempts).toBe(1);
    expect(j.source).toBe("nova");
    expect(j.candidate).toBeDefined();
    expect(j.firstTry).toBeUndefined();
  });

  it("accepts a corrected second answer and remembers why it had to correct", async () => {
    const s = scripted(overCap, inside);
    const j = await run(s);

    expect(s.calls()).toBe(2);
    expect(j.attempts).toBe(2);
    expect(j.source).toBe("nova");
    expect(j.candidate).toBeDefined();
    expect(j.firstTry).toMatch(/over its own cap/);
    expect(j.reason).toMatch(/after being refused/);
  });

  it("tells the model exactly what was wrong, and that the limits do not move", async () => {
    const s = scripted(overCap, inside);
    await run(s);

    const second = s.seen[1];
    expect(second).toHaveLength(3);                       // ask, its answer, the correction
    expect(second[1].role).toBe("assistant");
    expect(second[1].content[0].text).toBe(overCap);
    expect(second[2].content[0].text).toMatch(/over its own cap/);
    expect(second[2].content[0].text).toMatch(/not negotiable/);
  });

  it("gives up after the second answer is still outside the limits", async () => {
    const s = scripted(overCap, overCap);
    const j = await run(s);

    expect(s.calls()).toBe(2);                            // at most one retry, ever
    expect(j.attempts).toBe(2);
    expect(j.candidate).toBeUndefined();
    expect(j.source).toBe("rules");
    expect(j.reason).toMatch(/still refused after being told/);
    expect(j.firstTry).toMatch(/over its own cap/);
  });

  it("keeps the first answer's reason when the second one is unreadable", async () => {
    const s = scripted(overCap, "I would rather not say.");
    const j = await run(s);

    expect(j.attempts).toBe(2);
    expect(j.candidate).toBeUndefined();
    expect(j.reason).toMatch(/its second answer was unreadable/);
    expect(j.firstTry).toMatch(/over its own cap/);
  });

  it("does not retry an unreadable first answer", async () => {
    const s = scripted("no idea, sorry");
    const j = await run(s);

    expect(s.calls()).toBe(1);
    expect(j.reason).toMatch(/unreadable answer/);
    expect(j.source).toBe("rules");
  });

  it("does not argue with a decision to stand down", async () => {
    const s = scripted(standDown);
    const j = await run(s);

    expect(s.calls()).toBe(1);                            // not a mistake to correct
    expect(j.attempts).toBe(1);
    expect(j.candidate).toBeUndefined();
    expect(j.source).toBe("rules");
  });

  it("falls back to the rules when Bedrock throws, and never throws out", async () => {
    const s = scripted(Object.assign(new Error("socket hang up"), { name: "TimeoutError" }));
    const j = await run(s);

    expect(j.source).toBe("rules");
    expect(j.candidate).toBeUndefined();
    expect(j.reason).toMatch(/TimeoutError: socket hang up/);
  });

  it("survives a throw on the retry too", async () => {
    const s = scripted(overCap, new Error("second call failed"));
    const j = await run(s);

    expect(j.source).toBe("rules");
    expect(j.reason).toMatch(/second call failed/);
  });
});
