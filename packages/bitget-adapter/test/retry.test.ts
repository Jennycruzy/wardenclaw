import { describe, it, expect } from "vitest";
import { BitgetPublicMarketData, BitgetMcpMarketData, BitgetApiError, withRetry, type McpToolCaller } from "../src/index.js";
import type { FetchLike } from "../src/marketData.js";

const noSleep = async (): Promise<void> => {};

describe("withRetry", () => {
  it("retries retryable errors then succeeds", async () => {
    let calls = 0;
    const out = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("boom");
        return "ok";
      },
      { retries: 3, shouldRetry: () => true, sleep: noSleep },
    );
    expect(out).toBe("ok");
    expect(calls).toBe(3);
  });

  it("re-throws once the budget is spent", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("always");
        },
        { retries: 2, shouldRetry: () => true, sleep: noSleep },
      ),
    ).rejects.toThrow(/always/);
    expect(calls).toBe(3); // first try + 2 retries
  });

  it("never retries a non-retryable error", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("fatal");
        },
        { retries: 5, shouldRetry: () => false, sleep: noSleep },
      ),
    ).rejects.toThrow(/fatal/);
    expect(calls).toBe(1);
  });
});

describe("BitgetPublicMarketData 429 handling", () => {
  /** Fail with HTTP 429 the first `failures` times, then return a valid ticker. */
  function flakyFetch(failures: number): { fetch: FetchLike; count: () => number } {
    let n = 0;
    const fetch: FetchLike = async () => {
      n++;
      if (n <= failures) return { ok: false, status: 429, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: "00000",
          data: [{ symbol: "NVDAONUSDT", lastPr: "100", high24h: "1", low24h: "1", baseVolume: "1", quoteVolume: "1", ts: "1750000000000" }],
        }),
      };
    };
    return { fetch, count: () => n };
  }

  it("rides out transient 429s and returns the real price", async () => {
    const { fetch, count } = flakyFetch(2);
    const md = new BitgetPublicMarketData({ fetchImpl: fetch, retries: 3, sleep: noSleep });
    const t = await md.getTicker("NVDAONUSDT");
    expect(t.lastPrice).toBe(100);
    expect(count()).toBe(3); // two 429s, then success
  });

  it("fails loudly when 429s exceed the retry budget (never fabricates a price)", async () => {
    const { fetch } = flakyFetch(99);
    const md = new BitgetPublicMarketData({ fetchImpl: fetch, retries: 2, sleep: noSleep });
    await expect(md.getTicker("NVDAONUSDT")).rejects.toBeInstanceOf(BitgetApiError);
  });

  it("does NOT retry a non-429 HTTP error", async () => {
    let n = 0;
    const fetch: FetchLike = async () => {
      n++;
      return { ok: false, status: 503, json: async () => ({}) };
    };
    const md = new BitgetPublicMarketData({ fetchImpl: fetch, retries: 3, sleep: noSleep });
    await expect(md.getTicker("NVDAONUSDT")).rejects.toThrow(/HTTP 503/);
    expect(n).toBe(1);
  });
});

describe("BitgetMcpMarketData 429 handling", () => {
  const okTicker = {
    tool: "spot_get_ticker",
    ok: true,
    data: { data: [{ symbol: "NVDAONUSDT", lastPr: "100", high24h: "1", low24h: "1", baseVolume: "1", quoteVolume: "1", ts: "1781142361908" }] },
  };
  const err429 = { tool: "spot_get_ticker", ok: false, error: { type: "BitgetApiError", code: "429", message: "Too Many Requests" } };

  it("retries a 429 tool envelope then returns the real price", async () => {
    let n = 0;
    const client: McpToolCaller = {
      async callTool<T>(): Promise<T> {
        n++;
        return (n <= 2 ? err429 : okTicker) as T;
      },
    };
    const md = new BitgetMcpMarketData(client, { retries: 3, sleep: noSleep });
    const t = await md.getTicker("NVDAONUSDT");
    expect(t.lastPrice).toBe(100);
    expect(n).toBe(3);
  });

  it("does not retry a non-429 tool failure", async () => {
    let n = 0;
    const client: McpToolCaller = {
      async callTool<T>(): Promise<T> {
        n++;
        return { ok: false } as T;
      },
    };
    const md = new BitgetMcpMarketData(client, { retries: 3, sleep: noSleep });
    await expect(md.getTicker("NVDAONUSDT")).rejects.toThrow(/did not succeed/);
    expect(n).toBe(1);
  });
});
