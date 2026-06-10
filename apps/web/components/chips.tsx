/** Domain-specific status chips, shared so every table reads the same way. */
import { Badge, Dot } from "./ui";

export function ExecutionStatusChip({ status }: { status: string }) {
  switch (status) {
    case "filled":
      return (
        <Badge tone="pos">
          <Dot tone="pos" /> Filled
        </Badge>
      );
    case "rejected":
      return (
        <Badge tone="neg">
          <Dot tone="neg" /> Rejected
        </Badge>
      );
    case "submitted":
      return (
        <Badge tone="accent">
          <Dot tone="accent" /> Submitted
        </Badge>
      );
    case "failed":
      return (
        <Badge tone="neg">
          <Dot tone="neg" /> Failed
        </Badge>
      );
    default:
      return (
        <Badge tone="neutral">
          <Dot tone="neutral" /> Watch
        </Badge>
      );
  }
}

export function SignalFamilyChip({ family }: { family: string }) {
  const tone = family === "catalyst" ? "attack" : family === "momentum" ? "accent" : "neutral";
  return <Badge tone={tone}>{family}</Badge>;
}

export function ExecutionModeChip({ mode }: { mode: string }) {
  const label =
    mode === "official_bitget_demo"
      ? "Official Bitget demo"
      : mode === "internal_paper_engine"
        ? "Internal paper engine"
        : mode === "backtest"
          ? "Backtest"
          : mode;
  const tone = mode === "official_bitget_demo" ? "pos" : "accent";
  return <Badge tone={tone}>{label}</Badge>;
}

export function RejectChip({ code }: { code: string }) {
  return (
    <Badge tone="neg" className="font-mono">
      {code}
    </Badge>
  );
}
