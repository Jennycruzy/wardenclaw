/**
 * The xStock universe the reactor monitors, plus the optional (disabled) xPerps
 * module. The market-data client fails loudly if a symbol returns no data, so a
 * delisted/renamed symbol surfaces as an error rather than a fabricated price.
 */

import type { XStockSymbol } from "./types.js";

/**
 * Core tradeable xStock universe + index proxies for support checks.
 *
 * `bitgetSymbol` values VERIFIED against the live Bitget spot API
 * (GET /api/v2/spot/public/symbols). Two listing conventions exist and both are
 * used here, each pinned to a live, `online`, data-returning symbol:
 *   - "<TICKER>ON" series — the tokenized US equities (e.g. NVDAONUSDT).
 *   - "R<TICKER>" series  — the only place the BTC-correlated names list
 *     (RMSTRUSDT, RCOINUSDT); there is no MSTRON/COINON. Re-verified 2026-06-19:
 *     RMSTRUSDT and RCOINUSDT are `online` and return live tickers.
 *
 * Reconciliation decision (see docs/ARCHITECTURE_AUDIT.md): the tradeable set is
 * EXACTLY FIVE — three equities (AAPLx, NVDAx, TSLAx) plus two BTC-correlated
 * names (MSTRx, COINx) required for the HEDGE and CLOSE-ONLY verdicts. MSFTONUSDT
 * verifies too but is retired from the tradeable set to keep the universe at five;
 * QQQx/SPYx remain index proxies (not part of the five).
 */
export const XSTOCK_UNIVERSE: XStockSymbol[] = [
  { display: "AAPLx", bitgetSymbol: "AAPLONUSDT", underlying: "AAPL", kind: "xstock" },
  { display: "NVDAx", bitgetSymbol: "NVDAONUSDT", underlying: "NVDA", kind: "xstock" },
  { display: "TSLAx", bitgetSymbol: "TSLAONUSDT", underlying: "TSLA", kind: "xstock" },
  { display: "MSTRx", bitgetSymbol: "RMSTRUSDT", underlying: "MSTR", kind: "xstock", btcCorrelated: true },
  { display: "COINx", bitgetSymbol: "RCOINUSDT", underlying: "COIN", kind: "xstock", btcCorrelated: true },
  { display: "QQQx", bitgetSymbol: "QQQONUSDT", underlying: "QQQ", kind: "index_proxy" },
  { display: "SPYx", bitgetSymbol: "SPYONUSDT", underlying: "SPY", kind: "index_proxy" },
];

/** The tradeable (non-index-proxy) members of the universe — exactly five. */
export const TRADEABLE_XSTOCKS = XSTOCK_UNIVERSE.filter((s) => s.kind === "xstock");

/** The index proxies used for QQQ/SPY support checks. */
export const INDEX_PROXIES = XSTOCK_UNIVERSE.filter((s) => s.kind === "index_proxy");

/**
 * The BTC-correlated members (MSTRx, COINx). Trades on these carry crypto beta,
 * so the BTC-correlation gate can require a HEDGE and the watcher can flip them
 * CLOSE-ONLY when BTC realized vol spikes.
 */
export const BTC_CORRELATED_XSTOCKS = TRADEABLE_XSTOCKS.filter((s) => s.btcCorrelated === true);

/** Whether a display name (e.g. "MSTRx") is a BTC-correlated xStock. */
export function isBtcCorrelated(display: string): boolean {
  return BTC_CORRELATED_XSTOCKS.some((s) => s.display === display);
}

export function findXStock(display: string): XStockSymbol | undefined {
  return XSTOCK_UNIVERSE.find((s) => s.display === display);
}

/**
 * xPerps support is NOT officially verified. This module is intentionally
 * disabled. Enabling it requires confirming the Bitget xPerps endpoints and
 * symbol convention, then providing a real perps adapter — do not stub fills.
 */
export const XPERPS_MODULE = {
  enabled: false,
  reason:
    "Bitget xPerps support not officially verified. To enable: confirm the " +
    "xPerps endpoints/symbols from official Bitget docs, implement a real perps " +
    "market-data + execution adapter, then set BITGET_ENABLE_XPERPS=true.",
} as const;

export function assertXPerpsEnabled(envEnabled: boolean): void {
  if (!XPERPS_MODULE.enabled || !envEnabled) {
    throw new Error(`xPerps disabled: ${XPERPS_MODULE.reason}`);
  }
}
