import Link from "next/link";
import type { ReactNode } from "react";

export interface NavItem {
  href: string;
  label: string;
}

const BITGET_NAV: NavItem[] = [
  { href: "/bitget", label: "Overview" },
  { href: "/bitget/firewall", label: "Firewall" },
  { href: "/bitget/arena", label: "Arena" },
  { href: "/bitget/records", label: "Records" },
  { href: "/bitget/mandates", label: "Mandates" },
  { href: "/bitget/backtest", label: "Backtest" },
];

export function Shell({
  children,
  title,
  subtitle,
  actions,
  nav = BITGET_NAV,
  brand = "Firewall",
  home = "/bitget",
  footer,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  nav?: NavItem[];
  brand?: string;
  home?: string;
  footer?: ReactNode;
}) {
  const NAV = nav;
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-16 sm:px-6">
      <header className="sticky top-0 z-20 -mx-4 mb-6 border-b border-line/70 bg-bg/70 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={home} className="group flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-attack text-[13px] font-bold text-bg shadow-[0_0_16px_-2px_rgba(0,255,136,0.55)] transition group-hover:shadow-glow-lg animate-glow-pulse">
              W
            </span>
            <span className="text-sm font-semibold tracking-tight">
              <span className="bg-gradient-to-r from-ink to-accent bg-clip-text text-transparent">WARDENCLAW</span>{" "}
              <span className="text-ink-muted">{brand}</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="rounded-lg px-3 py-1.5 text-ink-muted transition hover:bg-accent/10 hover:text-accent hover:shadow-[0_0_18px_-8px_rgba(0,255,136,0.8)]"
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 animate-fade-up">
        <div className="max-w-2xl">
          <h1 className="bg-gradient-to-br from-ink via-ink to-ink-muted bg-clip-text text-2xl font-semibold tracking-tight text-transparent">
            {title}
          </h1>
          {subtitle ? <p className="mt-1 text-sm leading-relaxed text-ink-muted">{subtitle}</p> : null}
        </div>
        {actions}
      </div>

      <main className="flex-1">{children}</main>

      <footer className="mt-10 border-t border-line/60 pt-4 text-xs text-ink-faint">
        {footer ?? (
          <>
            Integrity: JSONL hash chain · Truth anchors: paper-fill source + market-data timestamp ·
            Paper trading on real Bitget market data — fills are simulated, never exchange fills.
          </>
        )}
      </footer>
    </div>
  );
}
