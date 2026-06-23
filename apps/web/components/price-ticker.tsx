"use client";

/**
 * Scrolling market ticker tape across the top of the dashboard. Polls the same
 * /api/bitget/live state the console publishes; when the console is offline it
 * shows the verified xStock universe with placeholder prices — never fabricated
 * numbers, just an honest "—" until the live agent is running.
 */

import { useEffect, useState } from "react";

interface TickerSymbol {
  symbol: string;
  price: number | null;
  change24hPct: number | null;
}

const POLL_MS = 5000;

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PriceTicker({ fallbackSymbols }: { fallbackSymbols: string[] }) {
  const [symbols, setSymbols] = useState<TickerSymbol[]>(
    fallbackSymbols.map((symbol) => ({ symbol, price: null, change24hPct: null })),
  );
  const [live, setLive] = useState(false);

  useEffect(() => {
    let active = true;
    const pull = async () => {
      try {
        const res = await fetch("/api/bitget/live", { cache: "no-store" });
        if (!res.ok) return;
        const state = (await res.json()) as {
          running?: boolean;
          symbols?: TickerSymbol[];
        };
        if (!active) return;
        if (state.running && state.symbols && state.symbols.length > 0) {
          setSymbols(
            state.symbols.map((s) => ({
              symbol: s.symbol,
              price: s.price,
              change24hPct: s.change24hPct,
            })),
          );
          setLive(true);
        } else {
          setLive(false);
        }
      } catch {
        /* transient — keep last good values */
      }
    };
    void pull();
    const t = setInterval(() => void pull(), POLL_MS);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  // Duplicate the row so the -50% keyframe loops seamlessly.
  const row = [...symbols, ...symbols];

  return (
    <div className="card mb-4 overflow-hidden p-0">
      <div className="flex items-stretch">
        <div className="z-10 flex shrink-0 items-center gap-2 border-r border-line/70 bg-bg-raised px-3 py-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse bg-accent shadow-[0_0_8px_rgba(0,255,136,0.9)]" : "bg-ink-faint"}`}
          />
          <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
            {live ? "live" : "mkt"}
          </span>
        </div>
        <div className="ticker-mask relative flex-1 overflow-hidden">
          <div className="flex w-max animate-ticker items-center gap-7 py-2 pl-7 hover:[animation-play-state:paused]">
            {row.map((s, i) => {
              const up = (s.change24hPct ?? 0) >= 0;
              return (
                <span key={`${s.symbol}-${i}`} className="flex items-center gap-2 whitespace-nowrap">
                  <span className="font-mono text-xs font-semibold text-ink">{s.symbol}</span>
                  <span className="tabular font-mono text-xs text-ink-muted">
                    {s.price !== null ? `$${fmt(s.price)}` : "—"}
                  </span>
                  {s.change24hPct !== null ? (
                    <span className={`tabular font-mono text-[11px] ${up ? "text-pos" : "text-neg"}`}>
                      {up ? "▲" : "▼"} {Math.abs(s.change24hPct).toFixed(1)}%
                    </span>
                  ) : null}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
