import { describe, it, expect } from "vitest";
import {
  buildMarketContext,
  gatherPerception,
  realizedVolPercentile,
  isNyseOpen,
  DEFAULT_MARKET_CONTEXT_CONFIG,
  findXStock,
  type BitgetCandle,
  type BitgetTicker,
  type MarketDataSource,
} from "../src/index.js";
import { evaluateTradePermit, type TradeIntent } from "@wardenclaw/core";
import { flatCandles } from "./helpers.js";

const NVDA = findXStock("NVDAx")!;
const MSTR = findXStock("MSTRx")!;

function ticker(over: Partial<BitgetTicker> = {}): BitgetTicker {
  return {
    symbol: "NVDAONUSDT", lastPrice: 100, high24h: 105, low24h: 95,
    baseVolume: 1000, quoteVolume: 100000, timestamp: "2026-06-19T15:00:00.000Z", ...over,
  };
}

// Wednesday 2026-06-17 15:00 UTC is inside the NYSE session window.
const OPEN_MS = Date.parse("2026-06-17T15:00:00.000Z");
// Saturday 2026-06-20 is closed.
const CLOSED_MS = Date.parse("2026-06-20T15:00:00.000Z");

describe("isNyseOpen", () => {
  it("open midweek inside the session, closed on the weekend", () => {
    expect(isNyseOpen(OPEN_MS, DEFAULT_MARKET_CONTEXT_CONFIG)).toBe(true);
    expect(isNyseOpen(CLOSED_MS, DEFAULT_MARKET_CONTEXT_CONFIG)).toBe(false);
  });
});

describe("realizedVolPercentile", () => {
  it("is low for a calm series", () => {
    expect(realizedVolPercentile(flatCandles(50), 12)).toBeLessThanOrEqual(1);
  });
});

describe("buildMarketContext", () => {
  it("assembles gate inputs from ticker + candles with sources", () => {
    const ctx = buildMarketContext({
      symbol: NVDA, ticker: ticker(), candles: flatCandles(50), nowMs: OPEN_MS,
    });
    expect(ctx.knownAsset).toBe(true);
    expect(ctx.btcCorrelated).toBe(false);
    expect(ctx.price).toBe(100);
    expect(ctx.marketOpen).toBe(true);
    expect(ctx.underlyingRefPrice).toBeDefined();
    expect(ctx.feedAgeSec).toBeGreaterThanOrEqual(0);
  });

  it("flags BTC-correlated symbols from the universe", () => {
    const ctx = buildMarketContext({ symbol: MSTR, ticker: ticker({ symbol: "RMSTRUSDT" }), candles: flatCandles(50), nowMs: OPEN_MS });
    expect(ctx.btcCorrelated).toBe(true);
  });

  it("marks the feed stale when the ticker timestamp is old", () => {
    const ctx = buildMarketContext({
      symbol: NVDA, ticker: ticker({ timestamp: "2026-06-19T14:00:00.000Z" }),
      candles: flatCandles(50), nowMs: Date.parse("2026-06-19T15:00:00.000Z"),
    });
    expect(ctx.feedAgeSec).toBeGreaterThan(60);
    // and the engine fails closed on it.
    const intent: TradeIntent = { asset: "NVDAx", direction: "long", notionalUsd: 100, leverage: 1, orderType: "market", triggerSource: "human", rawCommand: "x" };
    expect(evaluateTradePermit(intent, ctx).verdict).toBe("BLOCK");
  });

  it("passes through declared-source signals (earnings, news, BTC vol)", () => {
    const ctx = buildMarketContext({
      symbol: MSTR, ticker: ticker({ symbol: "RMSTRUSDT" }), candles: flatCandles(50), nowMs: OPEN_MS,
      signals: { earningsWithinHours: 10, newsShockAgeMin: 3, confirmationPresent: false, btcRealizedVolRising: true },
    });
    expect(ctx.earningsWithinHours).toBe(10);
    expect(ctx.newsShockAgeMin).toBe(3);
    expect(ctx.confirmationPresent).toBe(false);
    expect(ctx.btcRealizedVolRising).toBe(true);
  });
});

describe("gatherPerception (live IO over a MarketDataSource)", () => {
  it("fetches ticker+candles and assembles a usable context", async () => {
    const fake: MarketDataSource = {
      mode: "live_bitget_public",
      async getTicker() { return ticker(); },
      async getCandles() { return flatCandles(50) as BitgetCandle[]; },
    };
    const ctx = await gatherPerception(fake, NVDA, { nowMs: OPEN_MS });
    expect(ctx.price).toBe(100);
    expect(ctx.knownAsset).toBe(true);
  });
});
