import Link from "next/link";
import { BscShell } from "@/components/bscShell";
import { Card, Stat, SectionTitle, Badge, Dot, EmptyState } from "@/components/ui";
import { SignalFamilyChip, ExecutionStatusChip } from "@/components/chips";
import { RejectionBars } from "@/components/charts";
import { loadBscMandates, computeBscProof, readBscEnv } from "@/lib/data";
import { num, timeAgo, shortTime } from "@/lib/format";
import { DEFAULT_RISK_CONFIG } from "@runeclaw/core";
import { STARTER_STABLES, STARTER_MAJORS } from "@runeclaw/bsc-adapter";

export const dynamic = "force-dynamic";

export default function BscOverview() {
  const mandates = loadBscMandates();
  const proof = computeBscProof(mandates);
  const env = readBscEnv();
  const cfg = DEFAULT_RISK_CONFIG;
  const recent = mandates.slice(0, 8);

  return (
    <BscShell
      title="PnL-First BSC Trading Agent"
      subtitle="CMC is its eyes, TWAK is its hands — it only trades when calibrated edge beats real + simulated costs."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="pos"><Dot tone="pos" /> spot-only · ${env.startingCapitalUsd}</Badge>
          <Badge tone={env.cmcConfigured ? "pos" : "warn"}>CMC {env.cmcConfigured ? "live" : "not set"}</Badge>
          <Badge tone={env.twakConfigured ? "pos" : "warn"}>TWAK {env.twakConfigured ? "ready" : "not set"}</Badge>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Signal Mandates" value={num(proof.total)} sub={`updated ${timeAgo(proof.lastUpdated)}`} />
        <Stat label="Approved" value={num(proof.approved)} valueClass="text-pos" sub="passed every gate" />
        <Stat label="Gated skips" value={num(proof.rejected)} valueClass="text-neg" sub="net-edge / stop / shadow / eligibility" />
        <Stat label="Window budget" value={`${cfg.internalWindowDrawdownPct}%`} sub={`DQ cap ${cfg.competitionDqDrawdownPct}%`} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle title="Tradeable universe" subtitle="Liquidity-passing subset of the eligible list (by contract address)" />
          <div className="space-y-3">
            <div>
              <span className="mb-1.5 block text-xs font-medium text-ink-faint">Stables — parking + Micro-Scout legs</span>
              <div className="flex flex-wrap gap-1.5">
                {STARTER_STABLES.map((t) => (
                  <Badge key={t.symbol} tone="neutral" className="font-mono">{t.symbol}</Badge>
                ))}
              </div>
            </div>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-ink-faint">Liquid majors — momentum family</span>
              <div className="flex flex-wrap gap-1.5">
                {STARTER_MAJORS.map((t) => (
                  <Badge key={t.symbol} tone="accent" className="font-mono">{t.symbol}</Badge>
                ))}
              </div>
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-ink-muted">
            Native BNB is gas only and is never held as a position. The catalyst tier (ASTER, MYX, BRETT,
            PENGU, …) is enabled per token after its CMC contract resolves and its PancakeSwap route passes
            the liquidity, slippage, and route-safety gates.
          </p>
        </Card>

        <Card>
          <SectionTitle title="Why trades were skipped" subtitle="Deterministic reject codes" />
          {proof.byRejectCode.length === 0 ? (
            <p className="py-8 text-center text-xs text-ink-faint">No rejections recorded yet.</p>
          ) : (
            <RejectionBars data={proof.byRejectCode} />
          )}
        </Card>
      </div>

      <div className="mt-3">
        <SectionTitle
          title="Recent Signal Mandates"
          right={<Link href="/bsc/mandates" className="text-xs text-accent hover:underline">View all →</Link>}
        />
        {recent.length === 0 ? (
          <EmptyState
            title="No mandates yet"
            hint="Run the agent against real CMC perception to populate the audit trail. Live signing additionally requires a configured TWAK wallet."
            command="pnpm run:bsc-agent"
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
                      <Link href={`/bsc/mandates/${m.id}`} className="text-accent hover:underline">{m.asset}</Link>
                    </td>
                    <td className="px-4 py-3"><SignalFamilyChip family={m.decision.signalFamily} /></td>
                    <td className="tabular px-4 py-3 text-right">{m.decision.tradeScore || "—"}</td>
                    <td className="px-4 py-3"><ExecutionStatusChip status={m.execution.status} /></td>
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
    </BscShell>
  );
}
