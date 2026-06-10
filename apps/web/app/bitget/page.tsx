import Link from "next/link";
import { Shell } from "@/components/shell";
import { Badge, Card, Dot, EmptyState, Stat, SectionTitle } from "@/components/ui";
import { ExecutionStatusChip, SignalFamilyChip } from "@/components/chips";
import { RejectionBars } from "@/components/charts";
import {
  computePaperStats,
  loadBitgetMandates,
  readDashboardEnv,
} from "@/lib/data";
import { num, timeAgo, shortTime } from "@/lib/format";
import { TRADEABLE_XSTOCKS, INDEX_PROXIES } from "@runeclaw/bitget-adapter";

export const dynamic = "force-dynamic";

export default function BitgetOverview() {
  const mandates = loadBitgetMandates();
  const stats = computePaperStats(mandates);
  const env = readDashboardEnv();
  const recent = mandates.slice(0, 8);

  return (
    <Shell
      title="xStock Earnings/News Reactor"
      subtitle="Reacts to earnings/news/sentiment shocks — disciplined enough not to buy the first spike."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">
            <Dot tone="accent" /> Internal paper engine
          </Badge>
          <Badge tone={env.llmEnabled ? "pos" : "neutral"}>
            LLM: {env.llmEnabled ? env.llmProvider : "disabled (deterministic)"}
          </Badge>
          <Badge tone={env.agentHubConfigured ? "pos" : "warn"}>
            Agent Hub: {env.agentHubConfigured ? "configured" : "not configured"}
          </Badge>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Signal Mandates" value={num(stats.total)} sub={`updated ${timeAgo(stats.lastUpdated)}`} />
        <Stat label="Paper entries" value={num(stats.filled)} valueClass="text-pos" sub="filled this run" />
        <Stat label="Disciplined skips" value={num(stats.rejected)} valueClass="text-neg" sub="gated rejections" />
        <Stat label="Watching" value={num(stats.watching)} sub="armed / cooldown" />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle
            title="xStock universe"
            subtitle="Bitget symbols are NEEDS-VERIFICATION; unresolved symbols fail loudly, never priced."
          />
          <div className="flex flex-wrap gap-2">
            {TRADEABLE_XSTOCKS.map((s) => (
              <Badge key={s.display} tone="neutral" className="font-mono">
                {s.display}
              </Badge>
            ))}
            <span className="mx-1 self-center text-xs text-ink-faint">index support:</span>
            {INDEX_PROXIES.map((s) => (
              <Badge key={s.display} tone="accent" className="font-mono">
                {s.display}
              </Badge>
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-ink-muted">
            Flow: detect a real price/volume shock → reject the first spike → wait out the post-event
            cooldown → require sentiment + technical agreement → require index support → score → rank →
            paper-trade the strongest, with a volatility-derived stop. Every stage is hash-chained.
          </p>
        </Card>

        <Card>
          <SectionTitle title="Why trades were skipped" subtitle="Deterministic reject codes" />
          {stats.byRejectCode.length === 0 ? (
            <p className="py-8 text-center text-xs text-ink-faint">No rejections recorded yet.</p>
          ) : (
            <RejectionBars data={stats.byRejectCode} />
          )}
        </Card>
      </div>

      <div className="mt-3">
        <SectionTitle title="Recent Signal Mandates" right={
          <Link href="/bitget/mandates" className="text-xs text-accent hover:underline">
            View all →
          </Link>
        } />
        {recent.length === 0 ? (
          <EmptyState
            title="No mandates yet"
            hint="Run the paper agent against real Bitget market data to populate the audit trail and this dashboard. Backtest reports populate the Backtest tab."
            command="pnpm run:bitget-paper"
          />
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Asset</th>
                  <th className="px-4 py-3 font-medium">Family</th>
                  <th className="px-4 py-3 text-right font-medium">Score</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((m) => (
                  <tr key={m.id} className="border-b border-line/50 last:border-0 hover:bg-bg-subtle/50">
                    <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{shortTime(m.createdAt)}</td>
                    <td className="px-4 py-3 font-mono">
                      <Link href={`/bitget/mandates/${m.id}`} className="text-accent hover:underline">
                        {m.asset}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <SignalFamilyChip family={m.decision.signalFamily} />
                    </td>
                    <td className="tabular px-4 py-3 text-right">{m.decision.tradeScore || "—"}</td>
                    <td className="px-4 py-3">
                      <ExecutionStatusChip status={m.execution.status} />
                    </td>
                    <td className="max-w-[18rem] truncate px-4 py-3 text-xs text-ink-muted">
                      {m.decision.rejectedReasons?.[0] ?? m.decision.reason[0] ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </Shell>
  );
}
