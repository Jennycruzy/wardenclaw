/** Shared presentational primitives — one design system across the dashboards. */
import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`card p-5 ${className}`}>{children}</div>;
}

export function SectionTitle({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-ink-faint">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  valueClass = "",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  valueClass?: string;
}) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</span>
      <span className={`tabular text-2xl font-semibold ${valueClass}`}>{value}</span>
      {sub ? <span className="text-xs text-ink-muted">{sub}</span> : null}
    </Card>
  );
}

type Tone = "neutral" | "pos" | "neg" | "warn" | "accent" | "attack";

const toneClasses: Record<Tone, string> = {
  neutral: "border-line bg-bg-subtle text-ink-muted",
  pos: "border-pos/30 bg-pos/10 text-pos",
  neg: "border-neg/30 bg-neg/10 text-neg",
  warn: "border-warn/30 bg-warn/10 text-warn",
  accent: "border-accent/30 bg-accent/10 text-accent",
  attack: "border-attack/30 bg-attack/10 text-attack",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${toneClasses[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = "neutral" }: { tone?: Tone }) {
  const c: Record<Tone, string> = {
    neutral: "bg-ink-faint",
    pos: "bg-pos",
    neg: "bg-neg",
    warn: "bg-warn",
    accent: "bg-accent",
    attack: "bg-attack",
  };
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${c[tone]}`} />;
}

export function EmptyState({
  title,
  hint,
  command,
}: {
  title: string;
  hint: string;
  command?: string;
}) {
  return (
    <Card className="flex flex-col items-center justify-center gap-3 py-14 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-bg-subtle text-ink-faint">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
        </svg>
      </div>
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-1 max-w-md text-xs text-ink-muted">{hint}</p>
      </div>
      {command ? (
        <code className="rounded-lg border border-line bg-bg px-3 py-1.5 font-mono text-xs text-accent">
          {command}
        </code>
      ) : null}
    </Card>
  );
}

export function KeyValue({ k, v, mono = false }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/60 py-2 last:border-0">
      <span className="text-xs font-medium text-ink-faint">{k}</span>
      <span className={`text-right text-sm text-ink ${mono ? "font-mono break-all" : ""}`}>{v}</span>
    </div>
  );
}
