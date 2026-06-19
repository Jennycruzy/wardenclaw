/**
 * AssetLogo — a native-looking monogram badge for an xStock symbol.
 *
 * Bitget's public coin-logo catalog is hotlink-protected (cross-origin requests
 * 403) and uses hashed, non-symbol filenames, so there is no reliable symbol→URL
 * mapping to embed. We render a deterministic, branded monogram instead — it never
 * breaks and keeps the venue's dark-on-accent feel. If a real catalog URL is later
 * available it can be passed via `src` and the monogram becomes the fallback.
 */
import type { CSSProperties } from "react";

/** Stable hue in [0,360) derived from the symbol so each asset has a steady color. */
function hueFor(symbol: string): number {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) % 360;
  return h;
}

export function AssetLogo({ symbol, size = 24 }: { symbol: string; size?: number }) {
  const base = symbol.replace(/x$/i, "").toUpperCase();
  const initials = base.slice(0, base.length <= 4 ? base.length : 3);
  const hue = hueFor(symbol);
  const style: CSSProperties = {
    width: size,
    height: size,
    background: `hsl(${hue} 65% 18%)`,
    color: `hsl(${hue} 85% 72%)`,
    borderColor: `hsl(${hue} 60% 32%)`,
    fontSize: Math.max(8, Math.round(size * 0.36)),
  };
  return (
    <span
      title={symbol}
      aria-label={symbol}
      style={style}
      className="inline-flex shrink-0 items-center justify-center rounded-full border font-semibold tabular leading-none"
    >
      {initials}
    </span>
  );
}

/** A logo + display-name row, used in lists. */
export function AssetTag({ symbol, size = 22 }: { symbol: string; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <AssetLogo symbol={symbol} size={size} />
      <span className="font-medium">{symbol}</span>
    </span>
  );
}
