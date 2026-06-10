import Link from "next/link";
import { BscShell } from "@/components/bscShell";
import { Card, Stat, SectionTitle, Badge, EmptyState, Dot } from "@/components/ui";
import { SignalFamilyChip } from "@/components/chips";
import { EquityCurve } from "@/components/charts";
import {
  loadBscMandates,
  computeBscProof,
  loadHourlySnapshots,
  readBscEnv,
} from "@/lib/data";
import { DEFAULT_RISK_CONFIG } from "@wardenclaw/core";
import { totalReturnPct, maxDrawdownPct, type HourlySnapshot } from "@wardenclaw/core";
import { usd, pct, num, shortTime, signClass } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function BscProof() {
  const mandates = loadBscMandates();
  const proof = computeBscProof(mandates);
  const env = readBscEnv();
  const snaps = loadHourlySnapshots();
  const cfg = DEFAULT_RISK_CONFIG;

  const snapForCore: HourlySnapshot[] = snaps.map((s) => ({ hourIso: s.hourIso, valueUsd: s.valueUsd }));
  const totalReturn = snaps.length >= 2 ? totalReturnPct(snapForCore) : null;
  const maxDd = snaps.length >= 2 ? maxDrawdownPct(snapForCore) : null;
  const liveValue = snaps.length ? snaps[snaps.length - 1]!.valueUsd : null;
  const tradeRows = mandates.filter((m) => m.risk.approved);
  const weeklyTrades = tradeRows.length;

  return (
    <BscShell
      title="Judge Scoreboard"
      subtitle="Total return under the drawdown cap — verifiable in 30 seconds."
      actions={
        <Badge tone={env.executionType === "spot_only" ? "pos" : "warn"}>
          <Dot tone="pos" /> {env.executionType}
        </Badge>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Portfolio value"
          value={liveValue !== null ? usd(liveValue) : "—"}
          sub={liveValue !== null ? `from $${env.startingCapitalUsd} start` : "no snapshots yet"}
        />
        <Stat
          label="Total return"
          value={totalReturn !== null ? pct(totalReturn) : "—"}
          valueClass={signClass(totalReturn ?? undefined)}
        />
        <Stat
          label="Max drawdown"
          value={maxDd !== null ? pct(-maxDd) : "—"}
          valueClass="text-neg"
          sub={`DQ cap ${cfg.competitionDqDrawdownPct}% · budget ${cfg.internalWindowDrawdownPct}%`}
        />
        <Stat
          label="Weekly trades"
          value={`${weeklyTrades}/7`}
          valueClass={weeklyTrades >= 7 ? "text-pos" : "text-ink"}
          sub="verified minimum"
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle title="Hourly portfolio value" subtitle="Mirrors the organizers' hourly scoring" />
          {snaps.length >= 2 ? (
            <EquityCurve data={snaps.map((s) => ({ time: s.hourIso, equityUsd: s.valueUsd }))} />
          ) : (
            <p className="py-10 text-center text-xs text-ink-faint">
              No hourly snapshots yet. The snapshot job records portfolio value each hour during the live window.
            </p>
          )}
        </Card>

        <Card>
          <SectionTitle title="Registration proof" />
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-faint">Contract</span>
              <code className="font-mono text-xs text-ink-muted">{env.competitionContract.slice(0, 10)}…{env.competitionContract.slice(-6)}</code>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-faint">Agent wallet</span>
              <code className="font-mono text-xs text-ink-muted">{env.walletAddress ? `${env.walletAddress.slice(0, 8)}…` : "not set"}</code>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-faint">Registration tx</span>
              {env.registrationTxHash ? (
                <a
                  href={`https://bsctrace.com/tx/${env.registrationTxHash}`}
                  className="font-mono text-xs text-accent hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {env.registrationTxHash.slice(0, 10)}…
                </a>
              ) : (
                <Badge tone="warn">pending</Badge>
              )}
            </div>
          </div>
          <p className="mt-4 border-t border-line/60 pt-3 text-xs text-ink-faint">
            Integrity: JSONL hash chain. Truth anchors: BSC tx hash, TWAK receipt, x402 receipt per mandate.
          </p>
        </Card>
      </div>

      <div className="mt-3">
        <SectionTitle title="Trade ledger" subtitle="Every approved mandate with its CMC trigger and proof anchors" />
        {tradeRows.length === 0 ? (
          <EmptyState
            title="No live trades yet"
            hint="Approved mandates appear here with their CMC trigger, net-edge numbers, BSC tx hash, TWAK and x402 receipts. Run the agent to populate."
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
                  <th className="px-4 py-3 text-right font-medium">Size</th>
                  <th className="px-4 py-3 text-right font-medium">Net edge</th>
                  <th className="px-4 py-3 font-medium">CMC tools</th>
                  <th className="px-4 py-3 font-medium">BSC tx</th>
                </tr>
              </thead>
              <tbody>
                {tradeRows.map((m) => (
                  <tr key={m.id} className="border-b border-line/50 last:border-0 hover:bg-bg-subtle/50">
                    <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{shortTime(m.createdAt)}</td>
                    <td className="px-4 py-3 font-mono">
                      <Link href={`/bsc/mandates/${m.id}`} className="text-accent hover:underline">{m.asset}</Link>
                    </td>
                    <td className="px-4 py-3"><SignalFamilyChip family={m.decision.signalFamily} /></td>
                    <td className="tabular px-4 py-3 text-right">
                      {usd((m.execution.requestedOrder as { amountInUsd?: number } | undefined)?.amountInUsd)}
                    </td>
                    <td className="tabular px-4 py-3 text-right text-ink-muted">
                      {num(m.economics.expectedMoveBps)}/{m.economics.frictionBps.toFixed(0)} bps
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-muted">{(m.perception.cmcToolsUsed ?? []).join(", ") || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {m.proofAnchors.bscTxHash ? (
                        <a href={`https://bsctrace.com/tx/${m.proofAnchors.bscTxHash}`} className="text-accent hover:underline" target="_blank" rel="noreferrer">
                          {m.proofAnchors.bscTxHash.slice(0, 10)}…
                        </a>
                      ) : (
                        <span className="text-ink-faint">dry run</span>
                      )}
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
