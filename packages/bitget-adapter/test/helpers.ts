import type { BitgetCandle } from "../src/index.js";

/** Build a flat candle series at a constant price/volume. */
export function flatCandles(n: number, price = 100, volume = 1000): BitgetCandle[] {
  const bars: BitgetCandle[] = [];
  for (let i = 0; i < n; i++) {
    bars.push({
      time: new Date(Date.UTC(2026, 5, 1, 0, i)).toISOString(),
      open: price,
      high: price * 1.001,
      low: price * 0.999,
      close: price,
      volume,
    });
  }
  return bars;
}

/**
 * Build a series that is flat, then prints an up-shock on the last bar with a
 * volume surge. Useful for arming the reactor.
 */
export function shockSeries(opts: {
  flatBars?: number;
  basePrice?: number;
  baseVolume?: number;
  shockPct?: number;
  shockVolumeMult?: number;
}): BitgetCandle[] {
  const flatBars = opts.flatBars ?? 6;
  const basePrice = opts.basePrice ?? 100;
  const baseVolume = opts.baseVolume ?? 1000;
  const shockPct = opts.shockPct ?? 0.06;
  const shockVolumeMult = opts.shockVolumeMult ?? 3;

  const bars = flatCandles(flatBars, basePrice, baseVolume);
  const last = basePrice * (1 + shockPct);
  bars.push({
    time: new Date(Date.UTC(2026, 5, 1, 0, flatBars)).toISOString(),
    open: basePrice,
    high: last * 1.001,
    low: basePrice * 0.999,
    close: last,
    volume: baseVolume * shockVolumeMult,
  });
  return bars;
}

/** Append `n` continuation bars holding near the shock price (mild drift up). */
export function appendCalm(bars: BitgetCandle[], n: number, driftPct = 0.001): BitgetCandle[] {
  const out = [...bars];
  let price = out[out.length - 1]!.close;
  const baseVol = out[0]!.volume;
  for (let i = 0; i < n; i++) {
    price = price * (1 + driftPct);
    out.push({
      time: new Date(Date.UTC(2026, 5, 1, 1, i)).toISOString(),
      open: price * (1 - driftPct),
      high: price * 1.002,
      low: price * 0.998,
      close: price,
      volume: baseVol,
    });
  }
  return out;
}
