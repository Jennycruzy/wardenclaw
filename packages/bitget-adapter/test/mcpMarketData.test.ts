import { describe, it, expect } from "vitest";
import { BitgetMcpMarketData, type McpToolCaller } from "../src/index.js";

/** Fake MCP caller returning the verified bitget-mcp-server@1.1.0 envelope shape. */
function fakeClient(payloads: Record<string, unknown>): McpToolCaller {
  return {
    async callTool<T>(name: string): Promise<T> {
      if (!(name in payloads)) throw new Error(`unexpected tool ${name}`);
      return payloads[name] as T;
    },
  };
}

const tickerEnvelope = {
  tool: "spot_get_ticker",
  ok: true,
  data: {
    endpoint: "GET /api/v2/spot/market/tickers",
    data: [
      {
        symbol: "BTCUSDT",
        lastPr: "62235.39",
        high24h: "62860",
        low24h: "60727.6",
        baseVolume: "5037.46",
        quoteVolume: "310608913.0",
        ts: "1781142361908",
      },
    ],
  },
};

const candlesEnvelope = {
  tool: "spot_get_candles",
  ok: true,
  data: {
    data: [
      ["1781142300000", "62258.48", "62264.98", "62240.01", "62240.87", "0.97", "60911.9"],
      ["1781142360000", "62240.87", "62240.87", "62235.39", "62235.39", "0.03", "2128.9"],
    ],
  },
};

describe("BitgetMcpMarketData (live Agent Hub MCP source)", () => {
  it("reports the Agent Hub MCP mode", () => {
    const md = new BitgetMcpMarketData(fakeClient({}));
    expect(md.mode).toBe("live_bitget_agent_hub_mcp");
  });

  it("normalizes a real MCP ticker envelope", async () => {
    const md = new BitgetMcpMarketData(fakeClient({ spot_get_ticker: tickerEnvelope }));
    const t = await md.getTicker("BTCUSDT");
    expect(t.lastPrice).toBe(62235.39);
    expect(t.high24h).toBe(62860);
    expect(t.baseVolume).toBeCloseTo(5037.46);
    expect(new Date(t.timestamp).getTime()).toBe(1781142361908);
  });

  it("normalizes a real MCP candle envelope", async () => {
    const md = new BitgetMcpMarketData(fakeClient({ spot_get_candles: candlesEnvelope }));
    const c = await md.getCandles("BTCUSDT", "1min", 2);
    expect(c).toHaveLength(2);
    expect(c[1]!.close).toBe(62235.39);
    expect(c[0]!.open).toBe(62258.48);
  });

  it("throws (never fabricates) when the tool envelope is not ok", async () => {
    const md = new BitgetMcpMarketData(fakeClient({ spot_get_ticker: { ok: false } }));
    await expect(md.getTicker("BTCUSDT")).rejects.toThrow(/did not succeed/);
  });

  it("throws when no ticker row is returned", async () => {
    const md = new BitgetMcpMarketData(
      fakeClient({ spot_get_ticker: { ok: true, data: { data: [] } } }),
    );
    await expect(md.getTicker("NOPEUSDT")).rejects.toThrow(/No ticker/);
  });
});
