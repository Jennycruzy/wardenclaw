/** Firewall presentational primitives — large verdict badges + verification panel. */
import type { ReactNode } from "react";
import { Badge } from "@/components/ui";

type Tone = "neutral" | "pos" | "neg" | "warn" | "accent" | "attack";

const TRADE_TONE: Record<string, Tone> = {
  APPROVE: "pos",
  REDUCE: "warn",
  DELAY: "accent",
  HEDGE: "attack",
  BLOCK: "neg",
  CLOSE_ONLY: "neg",
};
const STRATEGY_TONE: Record<string, Tone> = {
  Certified: "pos",
  Restricted: "warn",
  Rejected: "neg",
};

/** A large, across-the-room verdict badge. */
export function VerdictBadge({ verdict, kind = "trade" }: { verdict: string; kind?: "trade" | "strategy" }) {
  const tone = (kind === "trade" ? TRADE_TONE : STRATEGY_TONE)[verdict] ?? "neutral";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-lg border px-4 py-2 text-lg font-bold uppercase tracking-wide ${toneClass(tone)}`}
    >
      {verdict.replace("_", "-")}
    </span>
  );
}

function toneClass(tone: Tone): string {
  const m: Record<Tone, string> = {
    neutral: "border-line bg-bg-subtle text-ink-muted",
    pos: "border-pos/40 bg-pos/10 text-pos",
    neg: "border-neg/40 bg-neg/10 text-neg",
    warn: "border-warn/40 bg-warn/10 text-warn",
    accent: "border-accent/40 bg-accent/10 text-accent",
    attack: "border-attack/40 bg-attack/10 text-attack",
  };
  return m[tone];
}

/** The fail-closed banner shown around execution / verification areas. */
export function FailClosedBanner() {
  return (
    <div className="rounded-lg border border-neg/30 bg-neg/10 px-4 py-2 text-center text-sm font-semibold text-neg">
      No valid Warden Permit = no execution. · Paper / sim only.
    </div>
  );
}

/** The verification panel — exact success/failure strings from the spec. */
export function VerificationRow({
  verified,
  permitId,
  jsonHash,
  status,
}: {
  verified: boolean;
  permitId: string;
  jsonHash: string;
  status: string;
}) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="flex items-center gap-2">
        <Badge tone={verified ? "pos" : "neg"}>{verified ? "Verified" : "Verification failed"}</Badge>
        <span className="text-ink-muted">{status}</span>
      </div>
      <p className={verified ? "text-pos" : "text-neg"}>
        {verified
          ? "Verified. This Warden Card matches the stored mandate JSON."
          : "Verification failed. Displayed card does not match stored mandate."}
      </p>
      <KV k="Permit ID" v={permitId} />
      <KV k="JSON hash" v={jsonHash} />
    </div>
  );
}

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-faint">{k}</span>
      <span className="tabular font-mono text-ink-muted">{v}</span>
    </div>
  );
}

/** Original vs Warden-adjusted comparison with an explicit changes list. */
export function ComparisonColumns({
  original,
  adjusted,
  changes,
}: {
  original: { label: string; rows: Array<[string, ReactNode]> };
  adjusted: { label: string; rows: Array<[string, ReactNode]> };
  changes: string[];
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Column title={original.label} rows={original.rows} muted />
      <Column title={adjusted.label} rows={adjusted.rows} />
      <div className="md:col-span-2">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Changes made</p>
        {changes.length === 0 ? (
          <p className="text-xs text-ink-muted">No changes — approved as requested.</p>
        ) : (
          <ul className="list-inside list-disc text-xs text-ink-muted">
            {changes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Column({ title, rows, muted = false }: { title: string; rows: Array<[string, ReactNode]>; muted?: boolean }) {
  return (
    <div className={`rounded-lg border border-line p-3 ${muted ? "opacity-70" : ""}`}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">{title}</p>
      <div className="flex flex-col gap-1 text-sm">
        {rows.map(([k, v], i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <span className="text-ink-faint">{k}</span>
            <span className="tabular">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
