import Link from "next/link";
import { Shell } from "@/components/shell";
import { Card, EmptyState } from "@/components/ui";
import { ExecutionStatusChip, SignalFamilyChip } from "@/components/chips";
import { loadBitgetMandates } from "@/lib/data";
import { shortTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function MandatesPage() {
  const mandates = loadBitgetMandates();

  return (
    <Shell title="Signal Mandates" subtitle={`${mandates.length} mandate${mandates.length === 1 ? "" : "s"} — every decision, traded or skipped, is replayable.`}>
      {mandates.length === 0 ? (
        <EmptyState
          title="No mandates yet"
          hint="Run the paper agent to generate Signal Mandates from real Bitget market data."
          command="pnpm run:bitget-paper"
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Asset</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Family</th>
                <th className="px-4 py-3 text-right font-medium">Score</th>
                <th className="px-4 py-3 text-right font-medium">Exp. move</th>
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
                  <td className="px-4 py-3 text-ink-muted">{m.action}</td>
                  <td className="px-4 py-3">
                    <SignalFamilyChip family={m.decision.signalFamily} />
                  </td>
                  <td className="tabular px-4 py-3 text-right">{m.decision.tradeScore || "—"}</td>
                  <td className="tabular px-4 py-3 text-right text-ink-muted">
                    {m.economics.expectedMoveBps ? `${m.economics.expectedMoveBps} bps` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <ExecutionStatusChip status={m.execution.status} />
                  </td>
                  <td className="max-w-[16rem] truncate px-4 py-3 text-xs text-ink-muted">
                    {m.decision.rejectedReasons?.[0] ?? m.decision.reason[0] ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/bitget/mandates/${m.id}`} className="text-xs text-accent hover:underline">
                      Detail →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Shell>
  );
}
