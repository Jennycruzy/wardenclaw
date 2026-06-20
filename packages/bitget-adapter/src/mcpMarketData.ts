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
import { withRetry } from "./retry.js";

/** Minimal tool-calling surface — satisfied by BitgetMcpClient; fakeable in tests. */
export interface McpToolCaller {
  callTool<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
}

interface McpEnvelope {
  tool?: string;
  ok?: boolean;
  data?: { endpoint?: string; requestTime?: string; data?: unknown };
  /** Present when a tool call fails — surfaces Bitget's underlying error code. */
  error?: { type?: string; code?: string; message?: string; suggestion?: string };
}

export interface BitgetMcpMarketDataOptions {
  /** Transient 429 retry budget (default 3). Set 0 to disable. */
  retries?: number;
  /** Base backoff in ms (default 400). */
  retryBaseDelayMs?: number;
  /** Injectable sleep so tests don't wait on real timers. */
  sleep?: (ms: number) => Promise<void>;
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
    const code = env?.error?.code;
    // status carries the underlying HTTP code (e.g. 429) so the retry layer can
    // distinguish a transient rate-limit from a permanent failure.
    const status = code !== undefined && /^\d+$/.test(code) ? Number(code) : undefined;
    const detail = env?.error?.message ? `: ${env.error.message}` : "";
    throw new BitgetApiError(
      `Bitget MCP tool ${tool} did not succeed (ok=${env?.ok}${code ? `, code=${code}` : ""})${detail}`,
      status,
      code,
    );
  }
  return env.data?.data;
}

export class BitgetMcpMarketData implements MarketDataSource {
  readonly mode = "live_bitget_agent_hub_mcp" as const;
  private readonly retries: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep?: (ms: number) => Promise<void>;

  constructor(
    private readonly client: McpToolCaller,
    opts: BitgetMcpMarketDataOptions = {},
  ) {
    this.retries = opts.retries ?? 3;
    this.retryBaseDelayMs = opts.retryBaseDelayMs ?? 400;
    this.sleep = opts.sleep;
  }

  /** Call a tool and unwrap it, retrying only on a transient HTTP 429. */
  private async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
    return withRetry(
      async () => unwrap(await this.client.callTool<McpEnvelope>(tool, args), tool),
      {
        retries: this.retries,
        baseDelayMs: this.retryBaseDelayMs,
        shouldRetry: (err) => err instanceof BitgetApiError && err.status === 429,
        sleep: this.sleep,
      },
    );
  }

  async getTicker(symbol: string): Promise<BitgetTicker> {
    const rows = await this.call("spot_get_ticker", { symbol });
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
    const rows = await this.call("spot_get_candles", { symbol, granularity, limit });
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
