"use client";

/**
 * Live agent panel for /bitget: mirrors the interactive console in the browser.
 * Polls /api/bitget/live (the state the console publishes every cycle) and lets
 * the user type commands (buy/close/news/tp/…) that the console executes — the
 * same deterministic interpreter, the same paper book, the same audit trail.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface LiveHeadline {
  headline: string;
  url: string | null;
  publishedAt: string;
}

interface LiveSymbol {
  symbol: string;
  price: number | null;
  change24hPct: number | null;
  volumeRatio: number | null;
  state: string;
  detail: string;
  error: string | null;
  news: {
    fetchedAt: string;
    event: { direction: string; confidence: number } | null;
    summary: string | null;
    headlines: LiveHeadline[];
  } | null;
}

interface LiveState {
  running: boolean;
  updatedAt: string | null;
  cycle?: number;
  paused?: boolean;
  tradingEnabled?: boolean;
  pollSeconds?: number;
  perception?: string;
  executionMode?: string;
  indexSupport?: number;
  derivatives?: { regime: string; score: number; fundingRate: number } | null;
  newsStatus?: string;
  symbols?: LiveSymbol[];
  book?: {
    equityUsd: number;
    cashUsd: number;
    positions: Array<{
      asset: string;
      entryPrice: number;
      quantity: number;
      stopPrice: number;
      markPrice: number;
    }>;
    closedTrades: Array<{ asset: string; pnlUsd: number; reason: string; exitPrice: number }>;
  };
  events?: Array<{ time: string; text: string }>;
}

const POLL_MS = 4000;

function usd(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ageSeconds(iso: string | null): number | null {
  if (!iso) return null;
  return Math.round((Date.now() - Date.parse(iso)) / 1000);
}

function DirectionBadge({ event }: { event: { direction: string; confidence: number } | null }) {
  if (!event || event.direction === "unknown") {
    return <span className="text-xs text-ink-faint">unclassified</span>;
  }
  const pct = `${Math.round(event.confidence * 100)}%`;
  if (event.direction === "positive")
    return <span className="text-xs font-medium text-pos">▲ positive {pct}</span>;
  if (event.direction === "negative")
    return <span className="text-xs font-medium text-neg">▼ negative {pct}</span>;
  return <span className="text-xs font-medium text-warn">◆ {event.direction} {pct}</span>;
}

export function LiveConsole() {
  const [state, setState] = useState<LiveState | null>(null);
  const [command, setCommand] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/bitget/live", { cache: "no-store" });
      if (res.ok) setState((await res.json()) as LiveState);
    } catch {
      // transient — next poll retries
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [state?.events]);

  const submit = useCallback(async () => {
    const line = command.trim();
    if (!line || sending) return;
    setSending(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/bitget/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: line }),
      });
      const body = (await res.json()) as { queued?: boolean; error?: string };
      if (body.queued) {
        setFeedback(`queued: ${line} — executing…`);
        setCommand("");
        setTimeout(() => void refresh(), 1500);
        setTimeout(() => void refresh(), 3500);
      } else {
        setFeedback(body.error ?? "command rejected");
      }
    } catch {
      setFeedback("network error — try again");
    } finally {
      setSending(false);
    }
  }, [command, sending, refresh]);

  const age = ageSeconds(state?.updatedAt ?? null);
  const online = Boolean(state?.running) && age !== null && age < 90;

  return (
    <div className="card mt-3 p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Live agent · news sentiment &amp; command console
          </h2>
          <p className="mt-0.5 text-xs text-ink-faint">
            Real headlines (Yahoo Finance RSS) classified by the LLM into the sentiment gate ·
            commands execute on the running paper agent and are fully audited.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {online ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> live · cycle {state?.cycle}
                {age !== null ? ` · ${age}s ago` : ""}
              </span>
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                  state?.tradingEnabled
                    ? "border-pos/30 bg-pos/10 text-pos"
                    : "border-warn/30 bg-warn/10 text-warn"
                }`}
              >
                {state?.paused ? "paused" : state?.tradingEnabled ? "trading (paper)" : "watch-only"}
              </span>
            </>
          ) : (
            <span className="inline-flex items-center rounded-full border border-warn/30 bg-warn/10 px-2.5 py-0.5 text-xs font-medium text-warn">
              console offline — start with: pnpm console:bitget
            </span>
          )}
        </div>
      </div>

      {online && state?.book ? (
        <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>
            equity <span className="tabular font-semibold">${usd(state.book.equityUsd)}</span>
          </span>
          <span className="text-ink-muted">
            cash <span className="tabular">${usd(state.book.cashUsd)}</span>
          </span>
          <span className="text-ink-muted">
            open <span className="tabular">{state.book.positions.length}</span> · closed{" "}
            <span className="tabular">{state.book.closedTrades.length}</span>
          </span>
          {typeof state.indexSupport === "number" ? (
            <span className="text-ink-muted">
              index support <span className="tabular">{state.indexSupport.toFixed(2)}</span>
            </span>
          ) : null}
          {state.derivatives ? (
            <span className="text-ink-muted">
              derivatives{" "}
              <span
                className={
                  state.derivatives.regime === "risk_on"
                    ? "text-pos"
                    : state.derivatives.regime === "risk_off"
                      ? "text-neg"
                      : "text-warn"
                }
              >
                {state.derivatives.regime}
              </span>
            </span>
          ) : null}
        </div>
      ) : null}

      {online && state?.symbols ? (
        <div className="mb-4 grid gap-2 sm:grid-cols-2">
          {state.symbols.map((s) => (
            <div key={s.symbol} className="rounded-lg border border-line/60 bg-bg-subtle/40 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-sm font-semibold">{s.symbol}</span>
                <span className="tabular text-sm">
                  {s.price !== null ? `$${usd(s.price)}` : "—"}
                  {s.change24hPct !== null ? (
                    <span
                      className={`ml-2 text-xs ${s.change24hPct >= 0 ? "text-pos" : "text-neg"}`}
                    >
                      {s.change24hPct >= 0 ? "+" : ""}
                      {s.change24hPct.toFixed(1)}%
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-xs uppercase tracking-wide text-ink-faint">{s.state}</span>
                <DirectionBadge event={s.news?.event ?? null} />
              </div>
              {s.error ? (
                <p className="mt-1 truncate text-xs text-neg">{s.error}</p>
              ) : s.news?.headlines[0] ? (
                <p className="mt-1 truncate text-xs text-ink-muted" title={s.news.summary ?? undefined}>
                  📰 {s.news.headlines[0].headline}
                </p>
              ) : (
                <p className="mt-1 text-xs text-ink-faint">no recent headlines</p>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {online && state?.book && state.book.positions.length > 0 ? (
        <div className="mb-4 space-y-1">
          {state.book.positions.map((p) => {
            const upl = (p.markPrice - p.entryPrice) * p.quantity;
            return (
              <p key={p.asset} className="font-mono text-xs text-ink-muted">
                ◉ {p.asset} qty {p.quantity.toFixed(4)} @ ${usd(p.entryPrice)} · stop $
                {usd(p.stopPrice)} · uPnL{" "}
                <span className={upl >= 0 ? "text-pos" : "text-neg"}>
                  {upl >= 0 ? "+" : "-"}${usd(Math.abs(upl))}
                </span>
              </p>
            );
          })}
        </div>
      ) : null}

      {online && state?.events && state.events.length > 0 ? (
        <div
          ref={feedRef}
          className="mb-4 max-h-44 overflow-y-auto rounded-lg border border-line/60 bg-black/40 p-3"
        >
          {state.events.map((e, i) => (
            <p key={i} className="font-mono text-[11px] leading-relaxed text-ink-muted">
              <span className="text-ink-faint">{e.time}</span> {e.text}
            </p>
          ))}
        </div>
      ) : null}

      <div className="flex gap-2">
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          disabled={!online}
          placeholder={
            online
              ? "type a command — buy NVDAx 500 · close all · news AAPLx · tp 2 · watch · help"
              : "console offline — commands unavailable"
          }
          className="flex-1 rounded-lg border border-line bg-bg-subtle px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <button
          onClick={() => void submit()}
          disabled={!online || sending || !command.trim()}
          className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-40"
        >
          {sending ? "…" : "run"}
        </button>
      </div>
      {feedback ? <p className="mt-2 text-xs text-ink-muted">{feedback}</p> : null}
    </div>
  );
}
