import { describe, expect, it } from "vitest";
import { buildSwap, fmt, POOL_FEE, quoteSwap, simOut, SLIPPAGE_BPS, SWAP_ABI, type SwapQuote } from "../src/tx/swap.js";
import { decodeFunctionData } from "viem";
import type { Deployments } from "../src/config.js";

const dep = {
  chainId: 11155111,
  simA: "0x9A6c374822AdA7AAA0590f1CE345a4FD949A467c",
  simB: "0xaab73d09E659A0F1898e19fBdD294371044DD524",
  swapSim: "0xff79706c842E4421948Ae1e1050EE4594a4240E5",
  sUSDC: "0xA13262C39A790dFb2B54e1FE4137C01CFB5e5Ea8",
  weth9Sentinel: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
  amuletLog: "0x93692bd72a7ebab60436470bb98a6672125fa1ae",
  selectors: {},
} as unknown as Deployments;

const PRICE = 245_165_774_618n; // $2451.66, the scale PositionSim speaks
const USER = "0x211828006b402e0aae8244fB95B362b9eFFf7736" as const;

function quote(over: Partial<SwapQuote> = {}): SwapQuote {
  return { route: "Nordstern", outUnits: 24_426_369n, rate: 2442.64, gasUsd: 0.25, from: "ETH", to: "USDC", amountIn: 10_000_000_000_000_000n, ...over };
}

describe("what the sim will actually pay", () => {
  it("matches SwapSim's own arithmetic for ETH in", () => {
    // 0.01 ETH * price / 1e20, minus 30 bps
    const raw = (10_000_000_000_000_000n * PRICE) / 10n ** 20n;
    expect(simOut("ETH", 10_000_000_000_000_000n, PRICE)).toBe((raw * 9970n) / 10_000n);
  });

  it("matches it the other way round", () => {
    const raw = (24_000_000n * 10n ** 20n) / PRICE;
    expect(simOut("USDC", 24_000_000n, PRICE)).toBe((raw * 9970n) / 10_000n);
  });
});

describe("the transaction the wrist will be asked to sign", () => {
  it("calls the sim router, not anything the quote named", () => {
    const b = buildSwap(dep, quote(), USER, PRICE, 1n);
    expect(b.to).toBe(dep.swapSim);
  });

  it("sends the ETH with the call when selling ETH, and none when buying it", () => {
    expect(buildSwap(dep, quote(), USER, PRICE, 1n).value).toBe(10_000_000_000_000_000n);
    expect(buildSwap(dep, quote({ from: "USDC", to: "ETH", amountIn: 24_000_000n }), USER, PRICE, 1n).value).toBe(0n);
  });

  it("demands a floor the sim can meet, one percent under its own answer", () => {
    const b = buildSwap(dep, quote(), USER, PRICE, 1n);
    const expected = simOut("ETH", 10_000_000_000_000_000n, PRICE);
    expect(b.minOut).toBe((expected * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n);
    expect(b.minOut).toBeLessThan(expected);
  });

  it("never takes the minimum from the mainnet quote", () => {
    // A wildly optimistic mainnet number must not raise the floor the sim has to clear.
    const b = buildSwap(dep, quote({ outUnits: 999_999_999n, rate: 99_999 }), USER, PRICE, 1n);
    expect(b.minOut).toBeLessThan(simOut("ETH", 10_000_000_000_000_000n, PRICE));
  });

  it("encodes the Uniswap v3 call shape, with the sim's own token addresses", () => {
    const b = buildSwap(dep, quote(), USER, PRICE, 1234n);
    const { args } = decodeFunctionData({ abi: SWAP_ABI, data: b.data });
    const p = (args as unknown as [{ tokenIn: string; tokenOut: string; fee: number; recipient: string; deadline: bigint; amountIn: bigint }])[0];
    expect(p.tokenIn.toLowerCase()).toBe(dep.weth9Sentinel.toLowerCase());
    expect(p.tokenOut.toLowerCase()).toBe(dep.sUSDC.toLowerCase());
    expect(p.fee).toBe(POOL_FEE);
    expect(p.recipient.toLowerCase()).toBe(USER.toLowerCase());
    expect(p.deadline).toBe(1234n);
    expect(p.amountIn).toBe(10_000_000_000_000_000n);
  });

  it("keeps both lines inside what the pendant can show", () => {
    const b = buildSwap(dep, quote(), USER, PRICE, 1n);
    expect(b.human.length).toBeLessThanOrEqual(96);
    expect(b.rationale.length).toBeLessThanOrEqual(96);
    expect(b.human).toContain("0.01 ETH");
  });
});

describe("asking for a price", () => {
  it("refuses a swap from a thing to itself", async () => {
    expect(await quoteSwap("ETH", "ETH", 1n)).toBeUndefined();
  });

  it("returns nothing rather than guessing when the aggregator will not answer", async () => {
    const g = globalThis as { fetch: typeof fetch };
    const real = g.fetch;
    for (const f of [
      async () => new Response("{}", { status: 500 }),
      async () => new Response(JSON.stringify({ message: "no route" })),
      async () => new Response(JSON.stringify({ estimate: { toAmount: "0" } })),
      async () => { throw new Error("offline"); },
    ]) {
      g.fetch = f as unknown as typeof fetch;
      expect(await quoteSwap("ETH", "USDC", 10n ** 16n)).toBeUndefined();
    }
    g.fetch = real;
  });

  it("reads the route and the rate out of a real-shaped answer", async () => {
    const g = globalThis as { fetch: typeof fetch };
    const real = g.fetch;
    g.fetch = (async () => new Response(JSON.stringify({
      toolDetails: { name: "Nordstern Finance" },
      estimate: { toAmount: "24426369", gasCosts: [{ amountUSD: "0.25" }] },
    }))) as unknown as typeof fetch;
    const q = await quoteSwap("ETH", "USDC", 10_000_000_000_000_000n);
    g.fetch = real;
    expect(q?.route).toBe("Nordstern Finance");
    expect(q?.outUnits).toBe(24_426_369n);
    expect(q?.rate).toBeCloseTo(2442.64, 1);
  });
});

describe("how amounts read", () => {
  it("trims ETH and keeps cents on USDC", () => {
    expect(fmt(10_000_000_000_000_000n, "ETH")).toBe("0.01 ETH");
    expect(fmt(24_426_369n, "USDC")).toBe("24.43 USDC");
  });
});
