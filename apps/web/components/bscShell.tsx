import type { ReactNode } from "react";
import { Shell, type NavItem } from "./shell";

const BSC_NAV: NavItem[] = [
  { href: "/bsc", label: "Overview" },
  { href: "/bsc/proof", label: "Proof" },
  { href: "/bsc/mandates", label: "Mandates" },
  { href: "/bsc/rules", label: "Rules" },
  { href: "/bsc/ops", label: "Ops" },
];

export function BscShell({
  children,
  title,
  subtitle,
  actions,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <Shell
      title={title}
      subtitle={subtitle}
      actions={actions}
      nav={BSC_NAV}
      brand="BSC"
      home="/bsc"
      footer={
        <>
          Spot-only on BSC mainnet · Eligibility keyed by contract address · TWAK is the sole signer
          (self-custody) · Integrity: JSONL hash chain + on-chain tx anchors.
        </>
      }
    >
      {children}
    </Shell>
  );
}
