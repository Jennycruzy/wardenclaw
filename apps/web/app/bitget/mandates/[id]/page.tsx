import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { Card, KeyValue, SectionTitle, Badge } from "@/components/ui";
import { ExecutionStatusChip, ExecutionModeChip, SignalFamilyChip, RejectChip } from "@/components/chips";
import { getBitgetMandate } from "@/lib/data";
import { pct, num, shortTime, signClass } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function MandateDetail({ params }: { params: { id: string } }) {
  const m = getBitgetMandate(params.id);
  if (!m) notFound();

  const fill = m.execution.paperFill as Record<string, unknown> | undefined;

  return (
    <Shell
      title={`${m.asset} mandate`}
      subtitle={shortTime(m.createdAt)}
      actions={
        <div className="flex items-center gap-2">
          <ExecutionStatusChip status={m.execution.status} />
          <Link
            href={`/bitget/replay/${m.id}`}
            className="rounded-lg border border-line bg-bg-raised px-3 py-1.5 text-xs text-ink-muted transition hover:text-ink"
          >
            Open replay →
          </Link>
        </div>
      }
    >
      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <SectionTitle title="Decision" />
          <div className="mb-3 flex items-center gap-2">
            <SignalFamilyChip family={m.decision.signalFamily} />
            <Badge tone="neutral">{m.decision.regime}</Badge>
            {m.decision.rejectedReasons?.map((r) => <RejectChip key={r} code={r} />)}
          </div>
          <KeyValue k="Trade score" v={m.decision.tradeScore || "—"} />
          <KeyValue k="Action" v={m.action} />
          <div className="mt-3 space-y-1.5">
            {m.decision.reason.map((r, i) => (
              <p key={i} className="text-xs text-ink-muted">
                • {r}
              </p>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle title="Economics" subtitle="Net-edge quality filter" />
          <KeyValue
            k="Net-edge"
            v={
              <Badge tone={m.economics.netEdgePassed ? "pos" : "neg"}>
                {m.economics.netEdgePassed ? "passed" : "blocked"}
              </Badge>
            }
          />
          <KeyValue k="Expected move" v={`${num(m.economics.expectedMoveBps)} bps`} />
          <KeyValue k="Friction" v={`${m.economics.frictionBps.toFixed(1)} bps`} />
          <KeyValue
            k="Stop distance"
            v={m.economics.stopDistancePct ? pct(m.economics.stopDistancePct * 100) : "—"}
          />
        </Card>

        <Card>
          <SectionTitle title="Risk" />
          <KeyValue
            k="Approved"
            v={<Badge tone={m.risk.approved ? "pos" : "neg"}>{m.risk.approved ? "yes" : "no"}</Badge>}
          />
          <KeyValue k="Risk class" v={m.risk.riskClass} />
          <KeyValue k="Max position" v={pct(m.risk.maxPositionPct)} />
          <KeyValue k="Per-trade risk" v={m.risk.perTradeRiskPct ? pct(m.risk.perTradeRiskPct) : "—"} />
          <KeyValue k="Max slippage" v={m.risk.maxSlippageBps ? `${m.risk.maxSlippageBps} bps` : "—"} />
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Execution" right={<ExecutionModeChip mode={m.execution.adapter} />} />
          <KeyValue k="Status" v={<ExecutionStatusChip status={m.execution.status} />} />
          {fill ? (
            <>
              <KeyValue k="Side" v={String(fill.side)} />
              <KeyValue k="Ref price" v={`$${Number(fill.refPrice).toFixed(4)}`} />
              <KeyValue k="Fill price" v={`$${Number(fill.fillPrice).toFixed(4)}`} />
              <KeyValue k="Notional" v={`$${Number(fill.notionalUsd).toFixed(2)}`} />
              <KeyValue
                k="Labeled"
                v={<Badge tone="warn">simulated · {String(fill.source)}</Badge>}
              />
            </>
          ) : (
            <p className="py-3 text-xs text-ink-faint">No fill — this mandate did not execute.</p>
          )}
          {m.result ? (
            <KeyValue
              k="PnL"
              v={<span className={signClass(m.result.pnlPct)}>{pct(m.result.pnlPct)}</span>}
            />
          ) : null}
        </Card>

        <Card>
          <SectionTitle title="Perception & proof anchors" />
          <KeyValue k="Source" v={m.perception.source} mono />
          <KeyValue k="Market data ts" v={m.perception.marketDataTimestamp ?? "—"} mono />
          <KeyValue k="Paper-fill source" v={m.proofAnchors.paperFillSource ?? "—"} mono />
          <KeyValue k="Integrity" v={<Badge tone="accent">JSONL hash chain</Badge>} />
          <KeyValue k="Replayable" v={m.audit.replayable ? "yes" : "no"} />
        </Card>
      </div>
    </Shell>
  );
}
