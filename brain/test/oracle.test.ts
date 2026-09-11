import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { formatQuote, maySync, readEthUsd, scaleTo8, MAX_FEED_AGE_S, type Quote } from "../src/chain/oracle.js";

const FEED = "0x694AA1769357215DE4FAC081bf1f309aDC325306" as const;

function quote(over: Partial<Quote> = {}): Quote {
  return { price: 245_165_774_618n, updatedAt: 1_757_000_000, ageS: 60, stale: false, description: "ETH / USD", feed: FEED, ...over };
}

describe("bringing a feed onto the sim's scale", () => {
  it("leaves an 8-decimal answer alone", () => {
    expect(scaleTo8(245_165_774_618n, 8)).toBe(245_165_774_618n);
  });

  it("brings an 18-decimal answer down", () => {
    expect(scaleTo8(2_451_000_000_000_000_000_000n, 18)).toBe(245_100_000_000n);
  });

  it("brings a 6-decimal answer up", () => {
    expect(scaleTo8(2_451_660_000n, 6)).toBe(245_166_000_000n);
  });
});

describe("how the price reads", () => {
  it("shows dollars and how fresh it is", () => {
    expect(formatQuote(quote())).toContain("$2451.66");
    expect(formatQuote(quote({ ageS: 45 }))).toContain("45s ago");
    expect(formatQuote(quote({ ageS: 2400 }))).toContain("40m ago");
    expect(formatQuote(quote({ ageS: 10_800 }))).toContain("3h ago");
  });

  it("says so out loud when the feed has gone quiet", () => {
    expect(formatQuote(quote({ ageS: MAX_FEED_AGE_S + 1, stale: true }))).toContain("STALE");
  });
});

/* A fake feed. The only untrusted input the brain reads straight off a contract, so what it
   does with a bad answer decides whether a wrong price reaches the position. */
function feedClient(o: { answer: bigint; decimals: number; updatedAt: number; description?: string }): PublicClient {
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "latestRoundData") return [1n, o.answer, BigInt(o.updatedAt), BigInt(o.updatedAt), 1n];
      if (functionName === "decimals") return o.decimals;
      return o.description ?? "ETH / USD";
    },
  } as unknown as PublicClient;
}

const NOW_S = 1_757_000_000;
const NOW = NOW_S * 1000;

describe("reading the feed", () => {
  it("refuses a feed answering zero or less", async () => {
    await expect(readEthUsd(feedClient({ answer: 0n, decimals: 8, updatedAt: NOW_S }), FEED, NOW))
      .rejects.toThrow(/answered 0/);
    await expect(readEthUsd(feedClient({ answer: -1n, decimals: 8, updatedAt: NOW_S }), FEED, NOW))
      .rejects.toThrow(/answered -1/);
  });

  it("converts a feed that does not speak 8 decimals, end to end", async () => {
    const q = await readEthUsd(feedClient({ answer: 2_451_660_000_000_000_000_000n, decimals: 18, updatedAt: NOW_S }), FEED, NOW);
    expect(q.price).toBe(245_166_000_000n);
    expect(formatQuote(q)).toContain("$2451.66");
  });

  it("counts how old the answer is, and calls a day-old one stale", async () => {
    const fresh = await readEthUsd(feedClient({ answer: 245_166_000_000n, decimals: 8, updatedAt: NOW_S - 600 }), FEED, NOW);
    expect(fresh.ageS).toBe(600);
    expect(fresh.stale).toBe(false);

    const old = await readEthUsd(feedClient({ answer: 245_166_000_000n, decimals: 8, updatedAt: NOW_S - MAX_FEED_AGE_S - 1 }), FEED, NOW);
    expect(old.stale).toBe(true);
  });

  it("never reports a negative age when the feed is ahead of our clock", async () => {
    const q = await readEthUsd(feedClient({ answer: 245_166_000_000n, decimals: 8, updatedAt: NOW_S + 120 }), FEED, NOW);
    expect(q.ageS).toBe(0);
    expect(q.stale).toBe(false);
  });
});

describe("whether the sims may be pointed at it", () => {
  it("writes only when asked and only from a fresh price", () => {
    expect(maySync(quote(), true)).toBe(true);
    expect(maySync(quote(), false)).toBe(false);
    expect(maySync(quote({ stale: true }), true)).toBe(false);
  });
});
