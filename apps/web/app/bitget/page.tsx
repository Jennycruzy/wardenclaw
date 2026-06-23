import Link from "next/link";
import { Shell } from "@/components/shell";
import { LiveConsole } from "@/components/live-console";
import { Badge, Card, Dot, EmptyState, Stat, SectionTitle } from "@/components/ui";
import { ExecutionStatusChip, SignalFamilyChip } from "@/components/chips";
import { AssetLogo } from "@/components/asset-logo";
import { RejectionBars } from "@/components/charts";
import {
  computePaperStats,
  loadBitgetMandates,
  readDashboardEnv,
} from "@/lib/data";
import { num, timeAgo, shortTime } from "@/lib/format";
import { TRADEABLE_XSTOCKS, INDEX_PROXIES } from "@wardenclaw/bitget-adapter";

export const dynamic = "force-dynamic";

export default function BitgetOverview() {
  const mandates = loadBitgetMandates();
  const stats = computePaperStats(mandates);
  const env = readDashboardEnv();
  const recent = mandates.slice(0, 8);

  return (
    <Shell
      title="Command Firewall for Bitget xStocks"
      subtitle="Audits the strategy, then audits each trade command — every verdict deterministic, every permit signed. No valid permit, no execution."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">
            <Dot tone="accent" />{" "}
            {env.bitgetExecutionMode === "official_bitget_demo"
              ? "Official Bitget demo"
              : "Internal paper engine"}
          </Badge>
          {env.bitgetDemoMissing.length > 0 && (
            <Badge tone="warn">demo creds missing: {env.bitgetDemoMissing.join(", ")}</Badge>
          )}
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
        <Stat label="Paper entries" value={num(stats.filled)} valueClass="text-pos" sub="filled across recorded runs" />
        <Stat label="Disciplined skips" value={num(stats.rejected)} valueClass="text-neg" sub="gated rejections" />
        <Stat label="Watching" value={num(stats.watching)} sub="armed / cooldown" />
      </div>

      <LiveConsole />

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle
            title="xStock universe"
            subtitle="Symbols verified against the live Bitget spot API (<TICKER>ON convention); unresolved symbols fail loudly, never priced."
          />
          <div className="flex flex-wrap items-center gap-2">
            {TRADEABLE_XSTOCKS.map((s) => (
              <span key={s.display} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg-subtle px-2 py-0.5 font-mono text-xs">
                <AssetLogo symbol={s.display} size={18} />
                {s.display}
                {s.btcCorrelated ? <span className="text-attack" title="BTC-correlated">₿</span> : null}
              </span>
            ))}
            <span className="mx-1 self-center text-xs text-ink-faint">index support:</span>
            {INDEX_PROXIES.map((s) => (
              <span key={s.display} className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-xs text-accent">
                <AssetLogo symbol={s.display} size={18} />
                {s.display}
              </span>
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
