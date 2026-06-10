import { describe, it, expect } from "vitest";
import {
  CmcClient,
  CmcApiError,
  isQuoteStale,
  buildMomentumInputs,
  buildCatalystInputs,
  buildAttribution,
  type FetchLike,
} from "../src/index.js";
import { scoreBsc } from "@wardenclaw/core";

function stub(body: unknown, ok = true, status = 200): FetchLike {
  return async () => ({ ok, status, json: async () => body });
}

const quotesBody = {
  data: {
    CAKE: {
      quote: {
        USD: {
          price: 2.5,
          percent_change_1h: 0.4,
          percent_change_24h: 6.2,
          volume_24h: 40_000_000,
          market_cap: 700_000_000,
          last_updated: "2026-06-22T00:00:00.000Z",
        },
      },
    },
  },
};

describe("CmcClient", () => {
  it("requires an API key (never fabricates data)", () => {
    expect(() => new CmcClient({ apiKey: "", fetchImpl: stub({}) })).toThrow(CmcApiError);
  });

  it("parses the real quotes response and tags the tool", async () => {
    const c = new CmcClient({ apiKey: "k", fetchImpl: stub(quotesBody), requestIdFactory: () => "req-1" });
    const sig = await c.getQuotes(["CAKE"]);
    expect(sig.tool).toBe("quotes");
    expect(sig.data[0]!.priceUsd).toBe(2.5);
    expect(sig.requestId).toBe("req-1");
  });

  it("throws loudly on an API error", async () => {
    const c = new CmcClient({ apiKey: "k", fetchImpl: stub({}, false, 429) });
    await expect(c.getQuotes(["CAKE"])).rejects.toThrow(/HTTP 429/);
  });

  it("throws when no quotes are returned", async () => {
    const c = new CmcClient({ apiKey: "k", fetchImpl: stub({ data: {} }) });
    await expect(c.getQuotes(["CAKE"])).rejects.toThrow(/no quotes/);
  });

  it("flags stale quotes", () => {
    const q = {
      symbol: "CAKE",
      priceUsd: 1,
      percentChange1h: 0,
      percentChange24h: 0,
      volume24hUsd: 1,
      marketCapUsd: 1,
      lastUpdated: new Date(1_000_000).toISOString(),
    };
    expect(isQuoteStale(q, 1_000_000 + 11 * 60_000, 10 * 60_000)).toBe(true);
    expect(isQuoteStale(q, 1_000_000 + 60_000, 10 * 60_000)).toBe(false);
  });
});

describe("perception → deterministic score inputs", () => {
  const quote = {
    symbol: "CAKE",
    priceUsd: 2.5,
    percentChange1h: 0.4,
    percentChange24h: 6.2,
    volume24hUsd: 40_000_000,
    marketCapUsd: 700_000_000,
    lastUpdated: "2026-06-22T00:00:00.000Z",
  };
  const fg = { value: 62, classification: "greed", lastUpdated: "2026-06-22T00:00:00.000Z" };

  it("momentum inputs produce a usable BSC score", () => {
    const { inputs, signalFamily } = buildMomentumInputs(quote, 2.0, fg, 0.7);
    expect(signalFamily).toBe("momentum");
    const score = scoreBsc(inputs);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
    // Relative strength vs BNB is a benchmark only; never implies holding BNB.
    expect(inputs.relativeStrengthVsBnb).toBeGreaterThan(0.5);
  });

  it("catalyst inputs lift momentum for a top-trending token", () => {
    const top = buildCatalystInputs(quote, { symbol: "CAKE", cmcId: 7186, rank: 1, percentChange24h: 6.2 }, fg, 0.7);
    const low = buildCatalystInputs(quote, { symbol: "CAKE", cmcId: 7186, rank: 18, percentChange24h: 6.2 }, fg, 0.7);
    expect(top.signalFamily).toBe("catalyst");
    expect(top.inputs.momentum).toBeGreaterThan(low.inputs.momentum);
  });

  it("builds tool attribution across signals", () => {
    const attribution = buildAttribution([
      { tool: "quotes", data: {}, timestamp: "t1", requestId: "r1" },
      { tool: "trending", data: {}, timestamp: "t2", requestId: "r2" },
      { tool: "quotes", data: {}, timestamp: "t3", requestId: "r3" },
    ]);
    expect(attribution.toolsUsed).toEqual(["quotes", "trending"]);
    expect(attribution.requestIds).toEqual(["r1", "r2", "r3"]);
  });
});
