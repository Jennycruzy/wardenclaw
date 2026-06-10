/**
 * The xStock universe the reactor monitors, plus the optional (disabled) xPerps
 * module. The Bitget API symbols are best-effort and marked NEEDS VERIFICATION:
 * the market-data client fails loudly if a symbol returns no data, so an
 * unverified symbol surfaces as an error rather than a fabricated price.
 */

import type { XStockSymbol } from "./types.js";

/**
 * Core tradeable xStock universe + index proxies for support checks.
 * `bitgetSymbol` values follow Bitget's tokenized-equity convention as best
 * understood; verify against official docs before live paper runs.
 */
export const XSTOCK_UNIVERSE: XStockSymbol[] = [
  { display: "AAPLx", bitgetSymbol: "AAPLXUSDT", underlying: "AAPL", kind: "xstock" },
  { display: "NVDAx", bitgetSymbol: "NVDAXUSDT", underlying: "NVDA", kind: "xstock" },
  { display: "TSLAx", bitgetSymbol: "TSLAXUSDT", underlying: "TSLA", kind: "xstock" },
  { display: "MSFTx", bitgetSymbol: "MSFTXUSDT", underlying: "MSFT", kind: "xstock" },
  { display: "QQQx", bitgetSymbol: "QQQXUSDT", underlying: "QQQ", kind: "index_proxy" },
  { display: "SPYx", bitgetSymbol: "SPYXUSDT", underlying: "SPY", kind: "index_proxy" },
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
