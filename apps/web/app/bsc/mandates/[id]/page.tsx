import Link from "next/link";
import { notFound } from "next/navigation";
import { BscShell } from "@/components/bscShell";
import { Card, KeyValue, SectionTitle, Badge } from "@/components/ui";
import { ExecutionStatusChip, SignalFamilyChip, RejectChip } from "@/components/chips";
import { getBscMandate } from "@/lib/data";
import { pct, num, shortTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function BscMandateDetail({ params }: { params: { id: string } }) {
  const m = getBscMandate(params.id);
  if (!m) notFound();
  const order = m.execution.requestedOrder as Record<string, unknown> | undefined;

  return (
    <BscShell
      title={`${m.asset} mandate`}
      subtitle={shortTime(m.createdAt)}
      actions={
        <div className="flex items-center gap-2">
          <ExecutionStatusChip status={m.execution.status} />
          <Link href={`/bsc/replay/${m.id}`} className="rounded-lg border border-line bg-bg-raised px-3 py-1.5 text-xs text-ink-muted transition hover:text-ink">
            Open replay →
          </Link>
        </div>
      }
    >
      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <SectionTitle title="Decision" />
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SignalFamilyChip family={m.decision.signalFamily} />
            <Badge tone="neutral">{m.decision.regime}</Badge>
            {m.decision.rejectedReasons?.map((r) => <RejectChip key={r} code={r} />)}
          </div>
          <KeyValue k="Trade score" v={m.decision.tradeScore || "—"} />
          <KeyValue k="Action" v={m.action} />
          <KeyValue k="Asset contract" v={m.assetContract ?? "—"} mono />
          <div className="mt-3 space-y-1.5">
            {m.decision.reason.map((r, i) => <p key={i} className="text-xs text-ink-muted">• {r}</p>)}
          </div>
        </Card>

        <Card>
          <SectionTitle title="Economics" subtitle="Real + simulated friction" />
          <KeyValue k="Net-edge" v={<Badge tone={m.economics.netEdgePassed ? "pos" : "neg"}>{m.economics.netEdgePassed ? "passed" : "blocked"}</Badge>} />
          <KeyValue k="Expected move" v={`${num(m.economics.expectedMoveBps)} bps`} />
          <KeyValue k="Friction (total)" v={`${m.economics.frictionBps.toFixed(1)} bps`} />
          <KeyValue k="— real" v={`${m.economics.realFrictionBps.toFixed(1)} bps`} />
          <KeyValue k="— simulated cost" v={`${m.economics.simulatedCostBps.toFixed(1)} bps`} />
          <KeyValue k="Stop distance" v={m.economics.stopDistancePct ? pct(m.economics.stopDistancePct * 100) : "—"} />
          <KeyValue k="Shadow dev" v={m.economics.shadowFillDeviationBps !== undefined ? `${m.economics.shadowFillDeviationBps.toFixed(1)} bps` : "—"} />
          <KeyValue k="Calibration" v={m.economics.calibrationVersion ?? "—"} />
        </Card>

        <Card>
          <SectionTitle title="Risk & execution" />
          <KeyValue k="Approved" v={<Badge tone={m.risk.approved ? "pos" : "neg"}>{m.risk.approved ? "yes" : "no"}</Badge>} />
          <KeyValue k="Risk class" v={m.risk.riskClass} />
          <KeyValue k="Max slippage" v={m.risk.maxSlippageBps ? `${m.risk.maxSlippageBps} bps` : "—"} />
          <KeyValue k="Adapter" v={m.execution.adapter} />
          <KeyValue k="Status" v={<ExecutionStatusChip status={m.execution.status} />} />
          {order ? <KeyValue k="Size" v={`$${Number(order.amountInUsd ?? 0).toFixed(2)}`} /> : null}
        </Card>
      </div>

      <Card className="mt-3">
        <SectionTitle title="Perception & proof anchors" />
        <div className="grid gap-x-8 sm:grid-cols-2">
          <div>
            <KeyValue k="Source" v={m.perception.source} mono />
            <KeyValue k="CMC tools" v={(m.perception.cmcToolsUsed ?? []).join(", ") || "—"} />
            <KeyValue k="Market data ts" v={m.perception.marketDataTimestamp ?? "—"} mono />
          </div>
          <div>
            <KeyValue k="BSC tx" v={m.proofAnchors.bscTxHash ?? "—"} mono />
            <KeyValue k="TWAK receipt" v={m.proofAnchors.twakReceipt ?? "—"} mono />
            <KeyValue k="x402 receipt" v={m.proofAnchors.x402Receipt ?? "—"} mono />
            <KeyValue k="Integrity" v={<Badge tone="accent">JSONL hash chain</Badge>} />
          </div>
        </div>
      </Card>
    </BscShell>
  );
}
