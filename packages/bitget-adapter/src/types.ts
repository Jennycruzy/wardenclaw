/**
 * Bitget-side types for RUNECLAW Stocks — the xStock earnings/news reactor.
 *
 * Everything here is paper/sim by design (the only simulation allowance in the
 * system). Market data is real Bitget public data; execution is internal paper
 * fills, always labeled as such — never presented as a real exchange fill.
 */

/** How an order was (or would be) filled. The dashboard must surface this. */
export type BitgetExecutionMode =
  | "official_bitget_demo"
  | "internal_paper_engine"
  | "backtest";

/** A tokenized-equity instrument tracked by the reactor. */
export interface XStockSymbol {
  /** Display name used across the UI, e.g. "NVDAx". */
  display: string;
  /**
   * The symbol the Bitget public API expects. NEEDS VERIFICATION against the
   * official Bitget xStocks/Stocks 2.0 docs — the adapter fails loudly if the
   * symbol returns no data rather than inventing a price.
   */
  bitgetSymbol: string;
  /** The underlying equity ticker, e.g. "NVDA". */
  underlying: string;
  kind: "xstock" | "index_proxy";
}

/** A normalized spot ticker parsed from the Bitget public API. */
export interface BitgetTicker {
  symbol: string;
  lastPrice: number;
  high24h: number;
  low24h: number;
  baseVolume: number;
  quoteVolume: number;
  /** ISO timestamp of the data, used as a freshness anchor. */
  timestamp: string;
}

/** A normalized OHLCV candle parsed from the Bitget public API. */
export interface BitgetCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** A raw news item from a real source (Agent Hub or a user-supplied feed). */
export interface NewsItem {
  id: string;
  asset: string;
  headline: string;
  body?: string;
  url?: string;
  source: string;
  publishedAt: string;
}

/** Bitget-side reject codes for skipped paper trades (distinct from BSC codes). */
export const BitgetRejectCode = {
  FIRST_SPIKE: "REJECT_FIRST_SPIKE",
  POST_EVENT_COOLDOWN: "REJECT_POST_EVENT_COOLDOWN",
  SENTIMENT_CONFLICT: "REJECT_SENTIMENT_CONFLICT",
  INDEX_HOSTILE: "REJECT_INDEX_HOSTILE",
  EVENT_UNCLEAR: "REJECT_EVENT_UNCLEAR",
  LOW_SCORE: "REJECT_LOW_SCORE",
  STALE_FEED: "REJECT_STALE_FEED",
  PAPER_FILL_SOURCE_MISSING: "REJECT_PAPER_FILL_SOURCE_MISSING",
  OVERSIZED_EXPOSURE: "REJECT_OVERSIZED_EXPOSURE",
  NO_SHOCK: "REJECT_NO_SHOCK",
} as const;
export type BitgetRejectCode =
  (typeof BitgetRejectCode)[keyof typeof BitgetRejectCode];
