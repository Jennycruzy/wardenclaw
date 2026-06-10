/**
 * CoinMarketCap Agent Hub adapter types.
 *
 * CMC is RUNECLAW BSC's perception layer ("its eyes"). Every signal records WHICH
 * CMC tool produced it, the timestamp, and (when x402-paid) the receipt — that
 * per-mandate attribution is the evidence for the "Best Use of Agent Hub" prize.
 * Nothing here fabricates market data; the client fails loudly without a key.
 */

/** The CMC Agent Hub tools RUNECLAW attributes decisions to. */
export type CmcTool =
  | "quotes"
  | "listings"
  | "dex_pairs"
  | "trending"
  | "fear_greed"
  | "news_social"
  | "derivatives"
  | "technical_indicators"
  | "contract_resolution";

export interface CmcQuote {
  symbol: string;
  priceUsd: number;
  percentChange1h: number;
  percentChange24h: number;
  volume24hUsd: number;
  marketCapUsd: number;
  /** ISO timestamp from CMC (freshness anchor). */
  lastUpdated: string;
}

export interface TrendingToken {
  symbol: string;
  cmcId: number;
  rank: number;
  percentChange24h: number;
}

export interface FearGreed {
  value: number; // 0..100
  classification: string;
  lastUpdated: string;
}

/** A perception reading tagged with the tool, timestamp, and optional x402 receipt. */
export interface CmcSignal<T> {
  tool: CmcTool;
  data: T;
  timestamp: string;
  /** x402 receipt id when this request was pay-per-request. */
  x402Receipt?: string;
  requestId?: string;
}

/** Records which CMC tools fed a given mandate, for dashboard attribution. */
export interface CmcAttribution {
  toolsUsed: CmcTool[];
  requestIds: string[];
  timestamps: string[];
}

export function buildAttribution(signals: Array<CmcSignal<unknown>>): CmcAttribution {
  return {
    toolsUsed: [...new Set(signals.map((s) => s.tool))],
    requestIds: signals.map((s) => s.requestId).filter((x): x is string => Boolean(x)),
    timestamps: signals.map((s) => s.timestamp),
  };
}
