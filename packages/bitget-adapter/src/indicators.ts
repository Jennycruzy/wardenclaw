/**
 * Small deterministic indicators derived from real candles. Kept separate so the
 * reactor and agent share one definition of volatility and trend.
 */

import type { BitgetCandle } from "./types.js";

/** Average true range over the last `period` bars, as a fraction of last close. */
export function atrPct(bars: BitgetCandle[], period = 14): number {
  if (bars.length < 2) return 0;
  const window = bars.slice(-Math.min(period + 1, bars.length));
  let trSum = 0;
  let count = 0;
  for (let i = 1; i < window.length; i++) {
    const cur = window[i]!;
    const prev = window[i - 1]!;
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    trSum += tr;
    count++;
  }
  const last = window[window.length - 1]!;
  if (count === 0 || last.close <= 0) return 0;
  return trSum / count / last.close;
}

/** Simple trend direction from the last two closes vs a short SMA. */
export function technicalDirection(bars: BitgetCandle[], smaPeriod = 5): "up" | "down" | "neutral" {
  if (bars.length < smaPeriod) return "neutral";
  const window = bars.slice(-smaPeriod);
  const sma = window.reduce((s, b) => s + b.close, 0) / window.length;
  const last = bars[bars.length - 1]!.close;
  const eps = sma * 0.001;
  if (last > sma + eps) return "up";
  if (last < sma - eps) return "down";
  return "neutral";
}
