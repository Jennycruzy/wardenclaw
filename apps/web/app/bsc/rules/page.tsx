import { BscShell } from "@/components/bscShell";
import { Card, SectionTitle, Badge, Dot } from "@/components/ui";
import { COMPETITION_RULES, verifyCompetitionRules } from "@runeclaw/core";

export const dynamic = "force-dynamic";

export default function BscRules() {
  const v = verifyCompetitionRules();
  const verified = COMPETITION_RULES.filter((r) => r.status === "verified");
  const open = COMPETITION_RULES.filter((r) => r.status !== "verified");

  return (
    <BscShell
      title="Competition Rules"
      subtitle="Verified from the official DoraHacks page. Four open items carry authoritative conservative defaults."
      actions={
        <Badge tone={v.ok ? "pos" : "neg"}>
          <Dot tone={v.ok ? "pos" : "neg"} /> {v.ok ? "verify passes" : "verify failing"}
        </Badge>
      }
    >
      <Card className="mb-3 border-warn/30 bg-warn/5">
        <SectionTitle title="Open items — conservative defaults are authoritative" subtitle="Nothing waits on these; a config update is the only change if answers arrive" />
        <div className="space-y-3">
          {open.map((r) => (
            <div key={r.rule} className="flex flex-col gap-1 border-b border-line/50 pb-3 last:border-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm text-ink">{r.rule}</span>
                <Badge tone="warn">needs confirmation</Badge>
              </div>
              {r.exactValue ? <span className="text-xs text-ink-muted">Default in use: {r.exactValue}</span> : null}
              <code className="font-mono text-[11px] text-ink-faint">{r.implementationFile}</code>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle title="Verified rules" subtitle={`${verified.length} rules, each with an implementation reference`} />
        <div className="space-y-2.5">
          {verified.map((r) => (
            <div key={r.rule} className="flex items-start justify-between gap-3 border-b border-line/50 py-2 last:border-0">
              <div>
                <span className="text-sm text-ink">{r.rule}</span>
                {r.exactValue ? <span className="ml-2 text-xs text-ink-muted">({r.exactValue})</span> : null}
                <code className="mt-0.5 block font-mono text-[11px] text-ink-faint">{r.implementationFile}</code>
              </div>
              <Badge tone="pos"><Dot tone="pos" /> verified</Badge>
            </div>
          ))}
        </div>
      </Card>
    </BscShell>
  );
}
