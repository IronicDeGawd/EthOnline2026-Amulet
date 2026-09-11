import { describe, expect, it } from "vitest";
import { formatQuote, scaleTo8, MAX_FEED_AGE_S, type Quote } from "../src/chain/oracle.js";

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
