import Link from "next/link";
import { BscShell } from "@/components/bscShell";
import { Card, EmptyState } from "@/components/ui";
import { ExecutionStatusChip, SignalFamilyChip } from "@/components/chips";
import { loadBscMandates } from "@/lib/data";
import { shortTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function BscMandates() {
  const mandates = loadBscMandates();
  return (
    <BscShell title="Signal Mandates" subtitle={`${mandates.length} mandate${mandates.length === 1 ? "" : "s"} — every decision is replayable with proof anchors.`}>
      {mandates.length === 0 ? (
        <EmptyState title="No mandates yet" hint="Run the BSC agent against real CMC perception to generate mandates." command="pnpm run:bsc-agent" />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Asset</th>
                <th className="px-4 py-3 font-medium">Family</th>
                <th className="px-4 py-3 text-right font-medium">Score</th>
                <th className="px-4 py-3 text-right font-medium">Exp / friction</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {mandates.map((m) => (
                <tr key={m.id} className="border-b border-line/50 last:border-0 hover:bg-bg-subtle/50">
                  <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{shortTime(m.createdAt)}</td>
                  <td className="px-4 py-3 font-mono">{m.asset}</td>
                  <td className="px-4 py-3"><SignalFamilyChip family={m.decision.signalFamily} /></td>
                  <td className="tabular px-4 py-3 text-right">{m.decision.tradeScore || "—"}</td>
                  <td className="tabular px-4 py-3 text-right text-ink-muted">
                    {m.economics.expectedMoveBps || 0}/{m.economics.frictionBps.toFixed(0)} bps
                  </td>
                  <td className="px-4 py-3"><ExecutionStatusChip status={m.execution.status} /></td>
                  <td className="max-w-[16rem] truncate px-4 py-3 text-xs text-ink-muted">
                    {m.decision.rejectedReasons?.[0] ?? m.decision.reason[0] ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/bsc/mandates/${m.id}`} className="text-xs text-accent hover:underline">Detail →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </BscShell>
  );
}
