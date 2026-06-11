import { Shell } from "@/components/shell";
import { Card, EmptyState, Stat, SectionTitle, Badge } from "@/components/ui";
import { EquityCurve } from "@/components/charts";
import { getLatestBacktest, listBacktests } from "@/lib/data";
import { usd, pct, num, shortTime, signClass } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function BacktestPage() {
  const report = getLatestBacktest();
  const all = listBacktests();

  if (!report) {
    return (
      <Shell title="Backtest" subtitle="Same shock/cooldown and net-edge logic the live paper agent uses.">
        <EmptyState
          title="No backtest reports yet"
          hint="Run a backtest over a real Bitget symbol, or use the synthetic shock-and-run series. Reports are written to data/backtests/."
          command="pnpm backtest:bitget -- NVDAXUSDT"
        />
      </Shell>
    );
  }

  const synthetic = report.source.startsWith("synthetic");

  return (
    <Shell
      title="Backtest"
      subtitle={`Source: ${report.source} · ${num(report.bars)} bars · ${shortTime(report.generatedAt)}`}
      actions={
        <Badge tone={synthetic ? "warn" : "pos"}>
          {synthetic ? "Synthetic series (labeled)" : "Real Bitget candles"}
        </Badge>
      }
    >
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
            <p className="py-8 text-center text-xs text-ink-faint">
              No trades in this window — the calibrated shock threshold is deliberately
              selective and this symbol printed no qualifying shock. The reactor refusing
              to trade here is the discipline working, not an error.
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
              {all.length} reports on disk · showing the most recent.
            </p>
          ) : null}
        </Card>
      </div>
    </Shell>
  );
}
