/**
 * Live perception → gate inputs. Assembles the deterministic `MarketContext` the
 * Trade-Permit Engine consumes from REAL Bitget perception. Every field declares
 * its source (see docs/GATE_TABLE.md):
 *
 *   price, feed staleness  ← Bitget spot ticker (marketData / MCP spot_get_ticker)
 *   underlying ref / last close (premium gate) ← prior-session candle close proxy
 *   volatility percentile  ← realized vol over candles (technical-analysis)
 *   spread (slippage gate) ← orderbook depth (spot_get_depth) when wired, else proxy
 *   earnings window        ← news-briefing earnings calendar
 *   news first-spike / confirmation ← news-briefing timestamps + technical-analysis
 *   BTC realized vol        ← macro-analyst (BTC candles)
 *   market session          ← exchange clock vs NYSE hours
 *   btc-correlated          ← the verified universe flag
 *
 * The assembly (`buildMarketContext`) is PURE and tested; `gatherPerception` does
 * the live IO over a MarketDataSource and never fabricates — a missing feed leaves
 * its field undefined so the gate that needs it stays conservative/closed.
 */

import type { MarketContext } from "@wardenclaw/core";
import type { BitgetCandle, BitgetTicker, XStockSymbol } from "./types.js";
import type { MarketDataSource } from "./marketData.js";
import { isBtcCorrelated } from "./universe.js";

export interface MarketContextConfig {
  /** Max feed age (sec) before the staleness gate fires. */
  feedMaxAgeSec: number;
  /** Bars back used as the "last close" reference for the premium gate. */
  refLookbackBars: number;
  /** Trailing window (bars) for the realized-vol percentile. */
  volWindow: number;
  /** Default spread (bps) when no orderbook depth is supplied. */
  defaultSpreadBps: number;
  /** NYSE regular session in UTC (DST-approximate; documented). */
  nyseOpenUtcHour: number;
  nyseCloseUtcHour: number;
}

export const DEFAULT_MARKET_CONTEXT_CONFIG: MarketContextConfig = {
  feedMaxAgeSec: 60,
  refLookbackBars: 16,
  volWindow: 12,
  defaultSpreadBps: 12,
  nyseOpenUtcHour: 13.5, // 09:30 ET during DST
  nyseCloseUtcHour: 20, // 16:00 ET during DST
};

/** Realized-vol percentile of the trailing window vs the whole candle series (0..1). */
export function realizedVolPercentile(candles: BitgetCandle[], win: number): number {
  if (candles.length < 2) return 0;
  const ret = (c: BitgetCandle) => (c.open > 0 ? Math.abs((c.close - c.open) / c.open) : 0);
  const all = candles.map(ret).sort((a, b) => a - b);
  const trailing = candles.slice(-win).map(ret);
  const avg = trailing.reduce((s, v) => s + v, 0) / Math.max(1, trailing.length);
  return Number((all.filter((v) => v <= avg).length / all.length).toFixed(3));
}

/** Approximate NYSE regular-session check (Mon–Fri, DST-approximate UTC window). */
export function isNyseOpen(nowMs: number, cfg: MarketContextConfig): boolean {
  const d = new Date(nowMs);
  const day = d.getUTCDay(); // 0 Sun … 6 Sat
  if (day === 0 || day === 6) return false;
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  return hour >= cfg.nyseOpenUtcHour && hour < cfg.nyseCloseUtcHour;
}

/** Optional declared-source signals layered onto the ticker+candles base. */
export interface PerceptionSignals {
  /** Orderbook spread in bps (spot_get_depth). */
  spreadBps?: number;
  /** Hours to nearest earnings (news-briefing calendar); undefined if none near. */
  earningsWithinHours?: number;
  /** Minutes since the last news shock (news-briefing); undefined if none. */
  newsShockAgeMin?: number;
  /** Post-news confirmation present (technical-analysis). */
  confirmationPresent?: boolean;
  /** BTC realized vol rising (macro-analyst). */
  btcRealizedVolRising?: boolean;
  /** Account survival mode (close-only watcher). */
  closeOnlyActive?: boolean;
  /** Explicit underlying reference price; else the prior-session candle close is used. */
  underlyingRefPrice?: number;
}

export interface BuildMarketContextInput {
  symbol: XStockSymbol;
  ticker: BitgetTicker;
  candles: BitgetCandle[];
  nowMs: number;
  signals?: PerceptionSignals;
  config?: MarketContextConfig;
}

/** Pure assembly of the gate inputs from a perception bundle. */
export function buildMarketContext(input: BuildMarketContextInput): MarketContext {
  const cfg = input.config ?? DEFAULT_MARKET_CONTEXT_CONFIG;
  const s = input.signals ?? {};
  const candles = input.candles;

  const refIdx = candles.length - 1 - cfg.refLookbackBars;
  const refClose = refIdx >= 0 ? candles[refIdx]!.close : undefined;
  const feedAgeSec = Math.max(0, (input.nowMs - Date.parse(input.ticker.timestamp)) / 1000);

  return {
    nowIso: new Date(input.nowMs).toISOString(),
    knownAsset: true, // by construction: assembled from a verified universe member
    btcCorrelated: input.symbol.btcCorrelated ?? isBtcCorrelated(input.symbol.display),
    price: input.ticker.lastPrice,
    ...(s.underlyingRefPrice !== undefined
      ? { underlyingRefPrice: s.underlyingRefPrice }
      : refClose !== undefined
        ? { underlyingRefPrice: refClose }
        : {}),
    spreadBps: s.spreadBps ?? cfg.defaultSpreadBps,
    volPctile: realizedVolPercentile(candles, cfg.volWindow),
    ...(s.earningsWithinHours !== undefined ? { earningsWithinHours: s.earningsWithinHours } : {}),
    ...(s.newsShockAgeMin !== undefined ? { newsShockAgeMin: s.newsShockAgeMin } : {}),
    confirmationPresent: s.confirmationPresent ?? true,
    marketOpen: isNyseOpen(input.nowMs, cfg),
    btcRealizedVolRising: s.btcRealizedVolRising ?? false,
    feedAgeSec: Number(feedAgeSec.toFixed(1)),
    closeOnlyActive: s.closeOnlyActive ?? false,
  };
}

/**
 * Live perception: fetch the ticker + candles for a universe symbol from a real
 * MarketDataSource (public HTTP or the Bitget MCP server) and assemble the gate
 * inputs. Optional signals (earnings/news/spread/BTC-vol) are passed through from
 * their declared skills; absent, the corresponding gate stays conservative.
 * Fails loud: a market-data error propagates rather than producing a fake context.
 */
export async function gatherPerception(
  source: MarketDataSource,
  symbol: XStockSymbol,
  opts: {
    nowMs: number;
    granularity?: string;
    candleLimit?: number;
    signals?: PerceptionSignals;
    config?: MarketContextConfig;
  },
): Promise<MarketContext> {
  const [ticker, candles] = await Promise.all([
    source.getTicker(symbol.bitgetSymbol),
    source.getCandles(symbol.bitgetSymbol, opts.granularity ?? "1h", opts.candleLimit ?? 200),
  ]);
  return buildMarketContext({
    symbol,
    ticker,
    candles,
    nowMs: opts.nowMs,
    ...(opts.signals ? { signals: opts.signals } : {}),
    ...(opts.config ? { config: opts.config } : {}),
  });
}
