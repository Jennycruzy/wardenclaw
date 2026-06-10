import Link from "next/link";
import { notFound } from "next/navigation";
import { BscShell } from "@/components/bscShell";
import { Card, KeyValue, SectionTitle, Badge, EmptyState } from "@/components/ui";
import { getReplay, getBscMandate } from "@/lib/data";
import { shortTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const STAGE_LABEL: Record<string, string> = {
  perception: "Perception",
  decision: "Decision",
  economics: "Economics",
  risk: "Risk",
  execution: "Execution",
  watchdog: "Watchdog",
  settlement: "Settlement",
};

export default function BscReplay({ params }: { params: { id: string } }) {
  const mandate = getBscMandate(params.id);
  const replay = getReplay(params.id);
  if (!mandate && !replay) notFound();

  return (
    <BscShell
      title="Replay"
      subtitle={params.id}
      actions={
        <Link href={`/bsc/mandates/${params.id}`} className="rounded-lg border border-line bg-bg-raised px-3 py-1.5 text-xs text-ink-muted transition hover:text-ink">
          ← Mandate detail
        </Link>
      }
    >
      {!replay ? (
        <EmptyState title="No audit events found" hint="The mandate exists but its hash-chained audit events were not found on disk. Re-run the agent to regenerate the trail." />
      ) : (
        <>
          <Card className="mb-3">
            <SectionTitle title="Integrity" subtitle="Hash chain proves the log was not altered — not market truth" />
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={replay.integrityOk ? "pos" : "neg"}>
                {replay.integrityOk ? "Hash chain intact" : `Broken at event #${replay.integrityBreakIndex}`}
              </Badge>
              <span className="text-xs text-ink-muted">{replay.stages.length} events</span>
            </div>
            <div className="mt-3 grid gap-1.5">
              <span className="text-xs font-medium text-ink-faint">Truth anchors</span>
              {replay.proof.truthAnchors.length === 0 ? (
                <span className="text-xs text-ink-muted">None recorded yet</span>
              ) : (
                replay.proof.truthAnchors.map((a) => <code key={a} className="break-all font-mono text-xs text-ink-muted">{a}</code>)
              )}
            </div>
          </Card>

          <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(["perception", "decision", "economics", "risk", "execution"] as const).map((stage) => {
              const data = replay[stage];
              if (!data) return null;
              return (
                <Card key={stage}>
                  <SectionTitle title={STAGE_LABEL[stage] ?? stage} />
                  <div className="space-y-1">
                    {Object.entries(data).map(([k, val]) => (
                      <KeyValue key={k} k={k} v={typeof val === "object" ? JSON.stringify(val) : String(val)} />
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>

          <Card>
            <SectionTitle title="Event timeline" />
            <ol className="relative ml-2 space-y-3 border-l border-line pl-5">
              {replay.stages.map((s, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[1.42rem] top-1 h-2 w-2 rounded-full bg-accent" />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{STAGE_LABEL[s.stage] ?? s.stage}</span>
                    <span className="text-xs text-ink-faint">{shortTime(s.timestamp)}</span>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </>
      )}
    </BscShell>
  );
}
