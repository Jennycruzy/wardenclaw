import Link from "next/link";
import type { ReactNode } from "react";

export interface NavItem {
  href: string;
  label: string;
}

const BITGET_NAV: NavItem[] = [
  { href: "/bitget", label: "Overview" },
  { href: "/bitget/mandates", label: "Mandates" },
  { href: "/bitget/backtest", label: "Backtest" },
];

export function Shell({
  children,
  title,
  subtitle,
  actions,
  nav = BITGET_NAV,
  brand = "Stocks",
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
      <header className="sticky top-0 z-10 -mx-4 mb-6 border-b border-line/70 bg-bg/80 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={home} className="group flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-attack text-[13px] font-bold text-bg">
              R
            </span>
            <span className="text-sm font-semibold tracking-tight">
              WARDENCLAW <span className="text-ink-muted">{brand}</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="rounded-lg px-3 py-1.5 text-ink-muted transition hover:bg-bg-raised hover:text-ink"
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-ink-muted">{subtitle}</p> : null}
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
