/**
 * Real Bitget public-market-data client.
 *
 * This calls the genuine Bitget v2 public REST API (no auth needed for public
 * market data) and normalizes the response. It NEVER fabricates a price: a
 * non-success response code, an empty payload, or a network error all throw a
 * typed error so the caller fails loudly. `fetch` is injectable so tests can
 * exercise the real response shape without a network.
 */

import type { BitgetCandle, BitgetTicker } from "./types.js";

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface BitgetMarketDataOptions {
  /** Defaults to the public Bitget API host. */
  baseUrl?: string;
  /** Injectable fetch (defaults to global fetch when available). */
  fetchImpl?: FetchLike;
}

export class BitgetApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "BitgetApiError";
  }
}

interface BitgetEnvelope {
  code?: string;
  msg?: string;
  data?: unknown;
}

function num(v: unknown, field: string): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  if (!Number.isFinite(n)) {
    throw new BitgetApiError(`Bitget field ${field} not numeric: ${String(v)}`);
  }
  return n;
}

export interface MarketDataSource {
  readonly mode: "live_bitget_public" | "live_bitget_agent_hub_mcp";
  getTicker(symbol: string): Promise<BitgetTicker>;
  getCandles(symbol: string, granularity: string, limit: number): Promise<BitgetCandle[]>;
}

export class BitgetPublicMarketData implements MarketDataSource {
  readonly mode = "live_bitget_public" as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: BitgetMarketDataOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://api.bitget.com").replace(/\/$/, "");
    const f = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
    if (!f) {
      throw new BitgetApiError(
        "No fetch implementation available. Pass fetchImpl or run on Node >=18.",
      );
    }
    this.fetchImpl = f;
  }

  private async get(path: string): Promise<unknown> {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, { method: "GET" });
    } catch (err) {
      throw new BitgetApiError(`Bitget request failed: ${(err as Error).message}`);
    }
    if (!res.ok) {
      throw new BitgetApiError(`Bitget HTTP ${res.status} for ${path}`, res.status);
    }
    const body = (await res.json()) as BitgetEnvelope;
    if (body.code !== undefined && body.code !== "00000") {
      throw new BitgetApiError(
        `Bitget API error ${body.code}: ${body.msg ?? "unknown"} (${path})`,
        res.status,
        body.code,
      );
    }
    return body.data;
  }

  async getTicker(symbol: string): Promise<BitgetTicker> {
    const data = await this.get(
      `/api/v2/spot/market/tickers?symbol=${encodeURIComponent(symbol)}`,
    );
    const rows = Array.isArray(data) ? data : [];
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      throw new BitgetApiError(
        `No ticker returned for ${symbol}. Verify the Bitget symbol exists (xStocks may use a different convention).`,
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
    const data = await this.get(
      `/api/v2/spot/market/candles?symbol=${encodeURIComponent(symbol)}&granularity=${encodeURIComponent(granularity)}&limit=${limit}`,
    );
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      throw new BitgetApiError(`No candles returned for ${symbol} @ ${granularity}.`);
    }
    // Bitget candle row: [ts, open, high, low, close, baseVol, quoteVol]
    return rows.map((r) => {
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

/** Staleness check used by the risk gate: market data older than maxAgeMs blocks. */
export function isTickerStale(ticker: BitgetTicker, now: number, maxAgeMs: number): boolean {
  return now - new Date(ticker.timestamp).getTime() > maxAgeMs;
}
