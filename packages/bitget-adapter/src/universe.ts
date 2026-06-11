/**
 * The xStock universe the reactor monitors, plus the optional (disabled) xPerps
 * module. The market-data client fails loudly if a symbol returns no data, so a
 * delisted/renamed symbol surfaces as an error rather than a fabricated price.
 */

import type { XStockSymbol } from "./types.js";

/**
 * Core tradeable xStock universe + index proxies for support checks.
 * `bitgetSymbol` values VERIFIED against the live Bitget spot API
 * (GET /api/v2/spot/public/symbols, 2026-06-11): tokenized equities trade
 * under the "<TICKER>ON" convention (e.g. NVDAONUSDT), with an alternate
 * "R<TICKER>" series also listed.
 */
export const XSTOCK_UNIVERSE: XStockSymbol[] = [
  { display: "AAPLx", bitgetSymbol: "AAPLONUSDT", underlying: "AAPL", kind: "xstock" },
  { display: "NVDAx", bitgetSymbol: "NVDAONUSDT", underlying: "NVDA", kind: "xstock" },
  { display: "TSLAx", bitgetSymbol: "TSLAONUSDT", underlying: "TSLA", kind: "xstock" },
  { display: "MSFTx", bitgetSymbol: "MSFTONUSDT", underlying: "MSFT", kind: "xstock" },
  { display: "QQQx", bitgetSymbol: "QQQONUSDT", underlying: "QQQ", kind: "index_proxy" },
  { display: "SPYx", bitgetSymbol: "SPYONUSDT", underlying: "SPY", kind: "index_proxy" },
];

/** The tradeable (non-index-proxy) members of the universe. */
export const TRADEABLE_XSTOCKS = XSTOCK_UNIVERSE.filter((s) => s.kind === "xstock");

/** The index proxies used for QQQ/SPY support checks. */
export const INDEX_PROXIES = XSTOCK_UNIVERSE.filter((s) => s.kind === "index_proxy");

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
