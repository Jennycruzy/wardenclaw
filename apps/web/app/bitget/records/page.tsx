import { Shell } from "@/components/shell";
import { Card, SectionTitle, Stat, Badge, EmptyState } from "@/components/ui";
import { AssetTag } from "@/components/asset-logo";
import { loadScorecard, loadFixtureCandles, loadLivePaperRecords } from "@/lib/data";
import { num, timeAgo } from "@/lib/format";
import { ghostCompare, type SimCandle } from "@wardenclaw/core";

export const dynamic = "force-dynamic";

function ghostFromFixtures() {
  const candles = loadFixtureCandles("NVDAx").slice(40, 88) as SimCandle[];
  if (candles.length < 2) return null;
  const entry = candles[0]!.open;
  return ghostCompare(
    { side: "long", notionalUsd: 500, leverage: 5, entryPrice: entry },
    { side: "long", notionalUsd: 250, leverage: 2, entryPrice: entry },
    candles,
  );
}

export default function RecordsPage() {
  const sc = loadScorecard();
  const ghost = ghostFromFixtures();
  const rec = loadLivePaperRecords();
  const perf = rec?.performance;
  const sd = sc?.summary as
    | { verdictDistribution?: Record<string, number>; aggregateMaxDrawdownUsd?: { without: number; with: number }; liquidations?: { avoided: number }; aggregatePnlUsd?: { without: number; with: number } }
    | undefined;

  return (
    <Shell title="Paper Records & Evidence" subtitle="NAV, round trips, ghost-sim counterfactuals, and the aggregate scorecard — all computed from real candles.">
      <div className="flex flex-col gap-6">
        {/* Paper records */}
        <Card>
          <SectionTitle
            title="Paper records"
            subtitle={rec ? `Actual running console book · updated ${timeAgo(rec.updatedAt)}` : "Actual running console book — no fixture fallback."}
            right={<Badge tone="neutral">PAPER</Badge>}
          />
          {rec ? (
            <>
              <div className="grid gap-3 sm:grid-cols-4">
                <Stat label="NAV (USD)" value={num(rec.navUsd)} />
                <Stat label="Realized PnL" value={num(rec.realizedPnlUsd)} valueClass={rec.realizedPnlUsd >= 0 ? "text-pos" : "text-neg"} />
                <Stat label="Unrealized PnL" value={num(rec.unrealizedPnlUsd)} valueClass={rec.unrealizedPnlUsd >= 0 ? "text-pos" : "text-neg"} />
                <Stat label="Open positions" value={rec.openPositions.length} />
              </div>
              {perf ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <Stat label="Win rate" value={`${perf.winRatePct}%`} sub={`${perf.wins}/${perf.closedTrades} wins`} />
                  <Stat label="Profit factor" value={perf.profitFactor === Infinity ? "∞" : num(perf.profitFactor)} />
                  <Stat label="Avg win" value={num(perf.avgWinUsd)} />
                  <Stat label="Avg loss" value={num(perf.avgLossUsd)} />
                </div>
              ) : (
                <p className="mt-3 text-xs text-ink-muted">No closed round trips in the current live paper book.</p>
              )}
            </>
          ) : (
            <EmptyState title="No live paper book" hint="Start the console and complete a scan. Records will remain empty rather than showing fixture trades." command="pnpm console:bitget" />
          )}
          {rec && rec.roundTrips.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-ink-faint">
                  <tr className="text-left"><th className="py-1">Source</th><th>Asset</th><th>Entry</th><th>Exit</th><th>PnL $</th><th>PnL %</th><th>Reason</th></tr>
                </thead>
                <tbody className="tabular">
                  {rec.roundTrips.map((t, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="py-1"><Badge tone="accent">{t.source}</Badge></td>
                      <td><AssetTag symbol={t.asset} size={18} /></td><td>{num(t.entryPrice)}</td><td>{num(t.exitPrice)}</td>
                      <td className={t.pnlUsd >= 0 ? "text-pos" : "text-neg"}>{num(t.pnlUsd)}</td>
                      <td className={t.pnlPct >= 0 ? "text-pos" : "text-neg"}>{num(t.pnlPct)}%</td>
                      <td className="text-ink-muted">{t.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Ghost simulation */}
        <Card>
          <SectionTitle title="Ghost simulation" subtitle="Original command vs Warden-adjusted order over the real forward candle path." />
          {ghost ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-line p-3 opacity-80">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Original ($500 @ 5x)</p>
                <KV k="Max drawdown" v={`${(ghost.original.maxDrawdownPct * 100).toFixed(0)}%`} />
                <KV k="Liquidated" v={ghost.original.liquidated ? "YES" : "no"} />
                <KV k="Final PnL" v={`$${num(ghost.original.finalPnlUsd)}`} />
              </div>
              <div className="rounded-lg border border-line p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Warden-adjusted ($250 @ 2x)</p>
                <KV k="Max drawdown" v={`${(ghost.wardenAdjusted.maxDrawdownPct * 100).toFixed(0)}%`} />
                <KV k="Liquidated" v={ghost.wardenAdjusted.liquidated ? "YES" : "no"} />
                <KV k="Final PnL" v={`$${num(ghost.wardenAdjusted.finalPnlUsd)}`} />
              </div>
              <div className="sm:col-span-2 text-xs text-ink-muted">
                Drawdown avoided: <span className="text-pos">${num(ghost.drawdownAvoidedUsd)}</span>
                {ghost.liquidationAvoided ? " · liquidation avoided" : ""} — computed from real NVDAx candles.
              </div>
            </div>
          ) : (
            <EmptyState title="No candle fixtures" hint="Run pnpm run:scorecard to cache candles." />
          )}
        </Card>

        {/* Scorecard summary */}
        <Card>
          <SectionTitle title="Aggregate scorecard" subtitle="From pnpm run:scorecard — computed from real Bitget candles." />
          {sd ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Max drawdown without" value={num(sd.aggregateMaxDrawdownUsd?.without ?? 0)} valueClass="text-neg" />
              <Stat label="Max drawdown with" value={num(sd.aggregateMaxDrawdownUsd?.with ?? 0)} valueClass="text-pos" />
              <Stat label="Liquidations avoided" value={sd.liquidations?.avoided ?? 0} />
              <Stat label="PnL without" value={num(sd.aggregatePnlUsd?.without ?? 0)} />
              <Stat label="PnL with" value={num(sd.aggregatePnlUsd?.with ?? 0)} />
              <div className="sm:col-span-1">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Verdicts</p>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(sd.verdictDistribution ?? {}).map(([v, n]) => (
                    <Badge key={v} tone="neutral">{v} {n as number}</Badge>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <EmptyState title="Scorecard not generated" hint="Run pnpm run:scorecard to produce output/scorecard.json." />
          )}
        </Card>
      </div>
    </Shell>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-ink-faint">{k}</span>
      <span className="tabular">{v}</span>
    </div>
  );
}
