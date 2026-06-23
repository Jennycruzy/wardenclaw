import Link from "next/link";
import { Shell } from "@/components/shell";
import { Card, EmptyState, Stat, SectionTitle, Badge } from "@/components/ui";
import { EquityCurve } from "@/components/charts";
import {
  getLatestBacktest,
  getBacktestBySource,
  latestBacktestPerSymbol,
  listBacktests,
} from "@/lib/data";
import { usd, pct, num, shortTime, signClass } from "@/lib/format";
import { XSTOCK_UNIVERSE } from "@wardenclaw/bitget-adapter";

export const dynamic = "force-dynamic";

/** Friendly display label for a backtest source like "bitget_public:TSLAONUSDT". */
function symbolLabel(source: string): string {
  const sym = source.split(":").pop() ?? source;
  const match = XSTOCK_UNIVERSE.find((x) => x.bitgetSymbol.toLowerCase() === sym.toLowerCase());
  return match?.display ?? sym;
}

export default function BacktestPage({
  searchParams,
}: {
  searchParams?: { symbol?: string };
}) {
  const perSymbol = latestBacktestPerSymbol();
  const selected = searchParams?.symbol ? getBacktestBySource(searchParams.symbol) : null;
  const report = selected ?? getLatestBacktest();
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

  return (
    <Shell
      title="Backtest"
      subtitle={`${symbolLabel(report.source)} · ${num(report.bars)} bars · ${shortTime(report.generatedAt)}`}
      actions={
        <Badge tone={stale ? "warn" : "pos"}>
          {stale ? "Real candles · stale report" : "Real Bitget candles · fresh"}
        </Badge>
      }
    >
      {perSymbol.length > 1 ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {perSymbol.map((r) => {
            const active = r.source === report.source;
            const traded = r.summary.numTrades > 0;
            return (
              <Link
                key={r.source}
                href={`/bitget/backtest?symbol=${encodeURIComponent(r.source)}`}
                scroll={false}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-xs transition ${
                  active
                    ? "border-accent/50 bg-accent/10 text-accent shadow-glow"
                    : "border-line bg-bg-subtle text-ink-muted hover:border-accent/30 hover:text-ink"
                }`}
              >
                {symbolLabel(r.source)}
                <span
                  className={`tabular text-[10px] ${
                    traded ? (active ? "text-accent" : "text-pos") : "text-ink-faint"
                  }`}
                >
                  {r.summary.numTrades}t
                </span>
              </Link>
            );
          })}
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
              {perSymbol.length} symbols · {all.length} reports on disk · showing{" "}
              {selected ? "the selected symbol" : "the latest symbol that traded"}.
            </p>
          ) : null}
        </Card>
      </div>
    </Shell>
  );
}
