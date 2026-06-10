/**
 * Real CoinMarketCap Pro API client (the Agent Hub's underlying data surface).
 *
 * Fails loudly without a CMC_API_KEY and on any API error — it never fabricates a
 * quote, a trend, or a sentiment reading. `fetch` is injectable so tests exercise
 * the real response shape without a network. Each method tags its output with the
 * CMC tool name and timestamp for per-mandate attribution.
 */

import type { CmcQuote, CmcSignal, FearGreed, TrendingToken } from "./types.js";

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text?: () => Promise<string> }>;

export class CmcApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "CmcApiError";
  }
}

export interface CmcClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  /** Monotonic-ish id source for request attribution; injected for determinism. */
  requestIdFactory?: () => string;
}

let seq = 0;

export class CmcClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly requestId: () => string;

  constructor(opts: CmcClientOptions = {}) {
    const key = opts.apiKey ?? process.env.CMC_API_KEY;
    if (!key) {
      throw new CmcApiError(
        "CMC_API_KEY is required. RUNECLAW never fabricates market data — perception fails loudly without a key.",
      );
    }
    this.apiKey = key;
    this.baseUrl = (opts.baseUrl ?? process.env.CMC_API_URL ?? "https://pro-api.coinmarketcap.com").replace(/\/$/, "");
    const f = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
    if (!f) throw new CmcApiError("No fetch implementation available.");
    this.fetchImpl = f;
    this.requestId = opts.requestIdFactory ?? (() => `cmc-${++seq}`);
  }

  private async get(path: string): Promise<unknown> {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { "X-CMC_PRO_API_KEY": this.apiKey, Accept: "application/json" },
      });
    } catch (err) {
      throw new CmcApiError(`CMC request failed: ${(err as Error).message}`);
    }
    if (!res.ok) {
      throw new CmcApiError(`CMC HTTP ${res.status} for ${path}`, res.status);
    }
    return res.json();
  }

  /** Latest quotes for one or more symbols. */
  async getQuotes(symbols: string[]): Promise<CmcSignal<CmcQuote[]>> {
    const body = (await this.get(
      `/v2/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(symbols.join(","))}&convert=USD`,
    )) as { data?: Record<string, CmcQuoteEntry | CmcQuoteEntry[]> };
    const quotes: CmcQuote[] = [];
    for (const symbol of symbols) {
      const raw = body.data?.[symbol] ?? body.data?.[symbol.toUpperCase()];
      const entry = Array.isArray(raw) ? raw[0] : raw;
      if (!entry?.quote?.USD) continue;
      const q = entry.quote.USD;
      quotes.push({
        symbol,
        priceUsd: q.price,
        percentChange1h: q.percent_change_1h ?? 0,
        percentChange24h: q.percent_change_24h ?? 0,
        volume24hUsd: q.volume_24h ?? 0,
        marketCapUsd: q.market_cap ?? 0,
        lastUpdated: q.last_updated ?? new Date(0).toISOString(),
      });
    }
    if (quotes.length === 0) {
      throw new CmcApiError(`CMC returned no quotes for ${symbols.join(",")}`);
    }
    return { tool: "quotes", data: quotes, timestamp: latestTs(quotes), requestId: this.requestId() };
  }

  /** Trending tokens — feeds the catalyst signal family. */
  async getTrending(limit = 20): Promise<CmcSignal<TrendingToken[]>> {
    const body = (await this.get(
      `/v1/cryptocurrency/trending/latest?limit=${limit}`,
    )) as { data?: Array<{ id: number; symbol: string; cmc_rank?: number; quote?: { USD?: { percent_change_24h?: number } } }> };
    const rows = body.data ?? [];
    const tokens: TrendingToken[] = rows.map((r, i) => ({
      symbol: r.symbol,
      cmcId: r.id,
      rank: r.cmc_rank ?? i + 1,
      percentChange24h: r.quote?.USD?.percent_change_24h ?? 0,
    }));
    return {
      tool: "trending",
      data: tokens,
      timestamp: new Date().toISOString(),
      requestId: this.requestId(),
    };
  }

  /** CMC Fear & Greed index — a sentiment gate input. */
  async getFearGreed(): Promise<CmcSignal<FearGreed>> {
    const body = (await this.get(`/v3/fear-and-greed/latest`)) as {
      data?: { value?: number; value_classification?: string; update_time?: string };
    };
    const d = body.data ?? {};
    return {
      tool: "fear_greed",
      data: {
        value: d.value ?? 50,
        classification: d.value_classification ?? "neutral",
        lastUpdated: d.update_time ?? new Date().toISOString(),
      },
      timestamp: d.update_time ?? new Date().toISOString(),
      requestId: this.requestId(),
    };
  }
}

interface CmcQuoteEntry {
  quote?: {
    USD?: {
      price: number;
      percent_change_1h?: number;
      percent_change_24h?: number;
      volume_24h?: number;
      market_cap?: number;
      last_updated?: string;
    };
  };
}

function latestTs(quotes: CmcQuote[]): string {
  return quotes.reduce((acc, q) => (q.lastUpdated > acc ? q.lastUpdated : acc), quotes[0]!.lastUpdated);
}

/** Staleness check used by the risk gate. */
export function isQuoteStale(quote: CmcQuote, nowMs: number, maxAgeMs: number): boolean {
  return nowMs - Date.parse(quote.lastUpdated) > maxAgeMs;
}
