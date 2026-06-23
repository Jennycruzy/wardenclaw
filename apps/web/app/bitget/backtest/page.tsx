import Link from "next/link";
import { Shell } from "@/components/shell";
import { Card, EmptyState, Stat, SectionTitle, Badge } from "@/components/ui";
import { EquityCurve } from "@/components/charts";
import type { BacktestReport } from "@/lib/data";
import {
  getLatestBacktest,
  getBestBacktest,
  getBacktestBySource,
  latestBacktestPerSymbol,
  listBacktests,
} from "@/lib/data";
import { usd, pct, num, shortTime, signClass } from "@/lib/format";
import { XSTOCK_UNIVERSE } from "@wardenclaw/bitget-adapter";

export const dynamic = "force-dynamic";

interface SourceInfo {
  /** Display ticker, e.g. "TSLAx". */
  symbol: string;
  /** Which gate produced it. */
  group: "live" | "calibrated";
  /** Short parameter caption for calibrated runs (empty for live). */
  variant: string;
}

/**
 * Parse a backtest source into a human-readable shape. Two forms exist on disk:
 *   bitget_public:<BITGETSYM>                          → the live production gate
 *   bitget_history:<TICKER>:calibrated_mag..tp..hold.. → a calibrated parameter run
 */
function describeSource(source: string): SourceInfo {
  const parts = source.split(":");
  if (parts[0] === "bitget_history" && parts[1]) {
    const params = parts[2] ?? "";
    const mag = /mag([\d.]+)/.exec(params)?.[1];
    const tp = /tp([\d.]+)/.exec(params)?.[1];
    const hold = /hold(\d+)/.exec(params)?.[1];
    const vol = /vol([\d.]+)/.exec(params)?.[1];
    const bits = [
      mag ? `mag ${(Number(mag) * 100).toFixed(1)}%` : null,
      vol ? `vol ${vol}×` : null,
      tp ? `tp ${(Number(tp) * 100).toFixed(1)}%` : null,
      hold ? `hold ${hold}` : null,
    ].filter(Boolean);
    return { symbol: parts[1], group: "calibrated", variant: bits.join(" · ") };
  }
  const sym = parts[parts.length - 1] ?? source;
  const match = XSTOCK_UNIVERSE.find((x) => x.bitgetSymbol.toLowerCase() === sym.toLowerCase());
  return { symbol: match?.display ?? sym, group: "live", variant: "" };
}

export default function BacktestPage({
  searchParams,
}: {
  searchParams?: { symbol?: string };
}) {
  const perSymbol = latestBacktestPerSymbol();
  const selected = searchParams?.symbol ? getBacktestBySource(searchParams.symbol) : null;
  const best = getBestBacktest();
  const report = selected ?? best ?? getLatestBacktest();
  const all = listBacktests();

  if (!report) {
    return (
      <Shell title="Backtest" subtitle="Same shock/cooldown and net-edge logic the live paper agent uses.">
        <EmptyState
          title="No backtest reports yet"
          hint="Run a backtest over a real Bitget symbol. Retrieval failures stop the run; no synthetic fallback is used."
          command="pnpm backtest:bitget -- NVDAx"
        />
      </Shell>
    );
  }

  const generatedAgeMs = Date.now() - Date.parse(report.generatedAt);
  const stale = !Number.isFinite(generatedAgeMs) || generatedAgeMs > 24 * 60 * 60 * 1000;
  const info = describeSource(report.source);
  const bestSource = best?.source ?? null;
  const calibrated = perSymbol.filter((r) => describeSource(r.source).group === "calibrated");
  const live = perSymbol.filter((r) => describeSource(r.source).group === "live");

  const renderChip = (r: BacktestReport) => {
    const active = r.source === report.source;
    const isBest = r.source === bestSource;
    const d = describeSource(r.source);
    const pnl = r.summary.pnlUsd;
    return (
      <Link
        key={r.source}
        href={`/bitget/backtest?symbol=${encodeURIComponent(r.source)}`}
        scroll={false}
        title={d.variant || "live production gate"}
        className={`group inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-xs transition ${
          active
            ? "border-accent/60 bg-accent/10 text-accent shadow-glow"
            : "border-line bg-bg-subtle text-ink-muted hover:border-accent/30 hover:text-ink"
        }`}
      >
        {isBest ? <span className="text-warn" title="Best run">★</span> : null}
        <span className="font-semibold">{d.symbol}</span>
        {d.variant ? (
          <span className="hidden text-[10px] text-ink-faint sm:inline">{d.variant}</span>
        ) : null}
        <span
          className={`tabular text-[10px] ${
            r.summary.numTrades === 0
              ? "text-ink-faint"
              : pnl > 0
                ? "text-pos"
                : pnl < 0
                  ? "text-neg"
                  : "text-ink-muted"
          }`}
        >
          {r.summary.numTrades === 0 ? "0t" : `${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(0)}`}
        </span>
      </Link>
    );
  };

  return (
    <Shell
      title="Backtest"
      subtitle={`${info.symbol}${info.variant ? ` · ${info.variant}` : " · live gate"} · ${num(report.bars)} bars · ${shortTime(report.generatedAt)}`}
      actions={
        <Badge tone={stale ? "warn" : "pos"}>
          {stale ? "Real candles · stale report" : "Real Bitget candles · fresh"}
        </Badge>
      }
    >
      {perSymbol.length > 1 ? (
        <div className="mb-4 space-y-2">
          {calibrated.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">
                Calibrated runs
              </span>
              {calibrated.map(renderChip)}
            </div>
          ) : null}
          {live.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">
                Live gate
              </span>
              {live.map(renderChip)}
            </div>
          ) : null}
        </div>
      ) : null}

      {report.thresholds ? (
        <p className="mb-3 text-xs text-ink-faint">
          Gate (matches the live agent):{" "}
          <span className="font-mono text-ink-muted">
            shock ≥ {(report.thresholds.shockMinMagnitudePct * 100).toFixed(1)}% over{" "}
            {report.thresholds.shockWindowBars} bars on ≥ {report.thresholds.shockMinVolumeRatio}× volume
          </span>{" "}
          · cooldown {report.thresholds.cooldownBars} bars · net-edge ≥ {report.thresholds.netEdgeMinBps} bps
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Total return"
          value={pct(report.summary.totalReturnPct)}
          valueClass={signClass(report.summary.totalReturnPct)}
        />
        <Stat
          label="Net PnL"
          value={usd(report.summary.pnlUsd)}
          valueClass={signClass(report.summary.pnlUsd)}
        />
        <Stat label="Max drawdown" value={pct(-report.summary.maxDrawdownPct)} valueClass="text-neg" />
        <Stat label="Win rate" value={`${report.summary.winRate}%`} sub={`${report.summary.numTrades} trades`} />
      </div>

      {report.equityCurve && report.equityCurve.length > 0 ? (
        <Card className="mt-3">
          <SectionTitle title="Equity curve" subtitle="Mark-to-market across the test window" />
          <EquityCurve data={report.equityCurve} />
        </Card>
      ) : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle title="Trades" />
          {report.trades.length === 0 ? (
            <p className="mx-auto max-w-md py-8 text-center text-xs leading-relaxed text-ink-faint">
              No trades across {num(report.bars)} bars — the shock gate{" "}
              {report.thresholds
                ? `(≥ ${(report.thresholds.shockMinMagnitudePct * 100).toFixed(1)}% over ${report.thresholds.shockWindowBars} bars on ≥ ${report.thresholds.shockMinVolumeRatio}× volume) `
                : ""}
              is deliberately selective and this symbol printed no qualifying shock in the
              window. The reactor refusing to trade here is the discipline working, not an error.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-faint">
                    <th className="px-3 py-2 font-medium">Entry</th>
                    <th className="px-3 py-2 font-medium">Exit</th>
                    <th className="px-3 py-2 text-right font-medium">Notional</th>
                    <th className="px-3 py-2 text-right font-medium">Friction</th>
                    <th className="px-3 py-2 text-right font-medium">PnL</th>
                    <th className="px-3 py-2 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {report.trades.map((t, i) => (
                    <tr key={i} className="border-b border-line/50 last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{shortTime(t.entryTime)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{shortTime(t.exitTime)}</td>
                      <td className="tabular px-3 py-2 text-right">{usd(t.notionalUsd)}</td>
                      <td className="tabular px-3 py-2 text-right text-ink-muted">{t.frictionBps.toFixed(0)} bps</td>
                      <td className={`tabular px-3 py-2 text-right ${signClass(t.pnlUsd)}`}>{usd(t.pnlUsd)}</td>
                      <td className="px-3 py-2 text-xs text-ink-muted">{t.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle title="Rejections" subtitle="Why candidates were skipped" />
          {Object.keys(report.rejections).length === 0 ? (
            <p className="py-8 text-center text-xs text-ink-faint">None recorded.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(report.rejections)
                .sort((a, b) => b[1] - a[1])
                .map(([code, count]) => (
                  <div key={code} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs text-ink-muted">{code}</span>
                    <span className="tabular font-medium">{count}</span>
                  </div>
                ))}
            </div>
          )}
          {all.length > 1 ? (
            <p className="mt-4 border-t border-line/60 pt-3 text-xs text-ink-faint">
              {perSymbol.length} runs · {all.length} reports on disk · showing{" "}
              {selected ? "the selected run" : "the best run by net PnL"}.
            </p>
          ) : null}
        </Card>
      </div>
    </Shell>
  );
}
