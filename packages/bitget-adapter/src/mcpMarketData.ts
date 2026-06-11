/**
 * Market-data source backed by the official Bitget Agent Hub MCP server
 * (`bitget-mcp-server`) instead of raw REST. This is the live Agent Hub
 * integration: every price/candle the reactor reacts to is fetched through the
 * official Agent Hub "Tools" layer in real time, and attributed as such.
 *
 * It is a drop-in `MarketDataSource` (same getTicker/getCandles contract as the
 * public REST client), so the reactor, ranker, and paper loop are unchanged. It
 * never fabricates a price: the MCP envelope's `ok` flag, an empty payload, or a
 * tool error all throw a typed error so the caller fails loudly.
 *
 * Verified envelope (bitget-mcp-server@1.1.0):
 *   { tool, ok, data: { endpoint, requestTime, data: <payload> }, capabilities }
 * where <payload> matches the underlying REST `data` (ticker rows / candle rows).
 */

import type { BitgetCandle, BitgetTicker } from "./types.js";
import { BitgetApiError, type MarketDataSource } from "./marketData.js";

/** Minimal tool-calling surface — satisfied by BitgetMcpClient; fakeable in tests. */
export interface McpToolCaller {
  callTool<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
}

interface McpEnvelope {
  tool?: string;
  ok?: boolean;
  data?: { endpoint?: string; requestTime?: string; data?: unknown };
}

function num(v: unknown, field: string): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  if (!Number.isFinite(n)) {
    throw new BitgetApiError(`Bitget MCP field ${field} not numeric: ${String(v)}`);
  }
  return n;
}

/** Unwrap the MCP tool envelope down to the underlying Bitget `data` payload. */
function unwrap(env: McpEnvelope, tool: string): unknown {
  if (!env || env.ok !== true) {
    throw new BitgetApiError(`Bitget MCP tool ${tool} did not succeed (ok=${env?.ok})`);
  }
  return env.data?.data;
}

export class BitgetMcpMarketData implements MarketDataSource {
  readonly mode = "live_bitget_agent_hub_mcp" as const;

  constructor(private readonly client: McpToolCaller) {}

  async getTicker(symbol: string): Promise<BitgetTicker> {
    const env = await this.client.callTool<McpEnvelope>("spot_get_ticker", { symbol });
    const rows = unwrap(env, "spot_get_ticker");
    const row = (Array.isArray(rows) ? rows[0] : undefined) as Record<string, unknown> | undefined;
    if (!row) {
      throw new BitgetApiError(
        `No ticker via Agent Hub MCP for ${symbol}. Verify the Bitget symbol exists (xStocks may use a different convention).`,
      );
    }
    return {
      symbol,
      lastPrice: num(row.lastPr ?? row.close, "lastPr"),
      high24h: num(row.high24h, "high24h"),
      low24h: num(row.low24h, "low24h"),
      baseVolume: num(row.baseVolume, "baseVolume"),
      quoteVolume: num(row.quoteVolume, "quoteVolume"),
      timestamp: new Date(Number(row.ts ?? Date.now())).toISOString(),
    };
  }

  async getCandles(symbol: string, granularity: string, limit: number): Promise<BitgetCandle[]> {
    const env = await this.client.callTool<McpEnvelope>("spot_get_candles", {
      symbol,
      granularity,
      limit,
    });
    const rows = unwrap(env, "spot_get_candles");
    const list = Array.isArray(rows) ? rows : [];
    if (list.length === 0) {
      throw new BitgetApiError(`No candles via Agent Hub MCP for ${symbol} @ ${granularity}.`);
    }
    // Bitget candle row: [ts, open, high, low, close, baseVol, quoteVol]
    return list.map((r) => {
      const a = r as unknown[];
      return {
        time: new Date(Number(a[0])).toISOString(),
        open: num(a[1], "open"),
        high: num(a[2], "high"),
        low: num(a[3], "low"),
        close: num(a[4], "close"),
        volume: num(a[5], "volume"),
      };
    });
  }
}
