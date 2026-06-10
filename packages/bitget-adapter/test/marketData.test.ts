import { describe, it, expect } from "vitest";
import { BitgetPublicMarketData, BitgetApiError, isTickerStale } from "../src/index.js";
import type { FetchLike } from "../src/marketData.js";

/** A fetch stub returning a canned Bitget v2 envelope. */
function stubFetch(body: unknown, ok = true, status = 200): FetchLike {
  return async () => ({ ok, status, json: async () => body });
}

describe("BitgetPublicMarketData", () => {
  it("parses the real v2 ticker response shape", async () => {
    const md = new BitgetPublicMarketData({
      fetchImpl: stubFetch({
        code: "00000",
        msg: "success",
        data: [
          {
            symbol: "NVDAXUSDT",
            lastPr: "123.45",
            high24h: "130.0",
            low24h: "120.0",
            baseVolume: "5000",
            quoteVolume: "600000",
            ts: "1750000000000",
          },
        ],
      }),
    });
    const t = await md.getTicker("NVDAXUSDT");
    expect(t.lastPrice).toBe(123.45);
    expect(t.high24h).toBe(130);
    expect(t.quoteVolume).toBe(600000);
    expect(t.symbol).toBe("NVDAXUSDT");
  });

  it("throws loudly on a Bitget error code (never fabricates a price)", async () => {
    const md = new BitgetPublicMarketData({
      fetchImpl: stubFetch({ code: "40034", msg: "param invalid", data: null }),
    });
    await expect(md.getTicker("BOGUS")).rejects.toBeInstanceOf(BitgetApiError);
  });

  it("throws when the symbol returns no rows", async () => {
    const md = new BitgetPublicMarketData({
      fetchImpl: stubFetch({ code: "00000", data: [] }),
    });
    await expect(md.getTicker("NVDAXUSDT")).rejects.toThrow(/No ticker/);
  });

  it("throws on a non-OK HTTP status", async () => {
    const md = new BitgetPublicMarketData({ fetchImpl: stubFetch({}, false, 503) });
    await expect(md.getTicker("NVDAXUSDT")).rejects.toThrow(/HTTP 503/);
  });

  it("parses candles into OHLCV", async () => {
    const md = new BitgetPublicMarketData({
      fetchImpl: stubFetch({
        code: "00000",
        data: [
          ["1750000000000", "100", "105", "99", "104", "1000", "104000"],
          ["1750000060000", "104", "108", "103", "107", "1200", "128000"],
        ],
      }),
    });
    const candles = await md.getCandles("NVDAXUSDT", "1min", 2);
    expect(candles).toHaveLength(2);
    expect(candles[1]!.close).toBe(107);
    expect(candles[0]!.high).toBe(105);
  });

  it("flags stale tickers", () => {
    const ticker = {
      symbol: "X",
      lastPrice: 1,
      high24h: 1,
      low24h: 1,
      baseVolume: 1,
      quoteVolume: 1,
      timestamp: new Date(1_000_000).toISOString(),
    };
    expect(isTickerStale(ticker, 1_000_000 + 61_000, 60_000)).toBe(true);
    expect(isTickerStale(ticker, 1_000_000 + 30_000, 60_000)).toBe(false);
  });
});
