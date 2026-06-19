import { Shell } from "@/components/shell";
import { Card, SectionTitle } from "@/components/ui";
import {
  VerdictBadge,
  FailClosedBanner,
  VerificationRow,
  ComparisonColumns,
} from "@/components/firewall";
import {
  auditStrategy,
  evaluateTradePermit,
  issuePermit,
  PermitStore,
  verifyCard,
  type TradeIntent,
  type MarketContext,
} from "@wardenclaw/core";

export const dynamic = "force-dynamic";

const NOW = "2026-06-19T15:00:00.000Z";
const KEY = process.env.WARDEN_SIGNING_KEY ?? "wardenclaw-dashboard-key";

function ctx(over: Partial<MarketContext> = {}): MarketContext {
  return {
    nowIso: NOW, knownAsset: true, btcCorrelated: false, price: 100, underlyingRefPrice: 100,
    spreadBps: 10, volPctile: 0.3, confirmationPresent: true, marketOpen: true,
    btcRealizedVolRising: false, feedAgeSec: 5, closeOnlyActive: false, ...over,
  };
}
function intent(over: Partial<TradeIntent>): TradeIntent {
  return {
    asset: "NVDAx", direction: "long", notionalUsd: 500, leverage: 5,
    orderType: "market", triggerSource: "human", rawCommand: "", ...over,
  };
}

export default function FirewallPage() {
  // Checkpoint 1 — Playbook Shield.
  const strategies = [
    { label: "Clean momentum strategy", text: "Trade NVDAx on confirmed momentum. Never enter the first spike; 3-bar cooldown after news, require volume confirmation. Daily loss 4%. No leverage above 2x." },
    { label: "Aggressive 4x strategy", text: "Long NVDAx with 4x leverage on momentum. Daily loss 4%, cooldown after news, confirmation." },
    { label: "Martingale strategy", text: "Double position size after every loss to recover. 10x on any spike." },
  ].map((s) => ({ ...s, audit: auditStrategy({ strategy: s.text, signingKey: KEY, nowIso: NOW, expiresAtIso: NOW }) }));

  // Checkpoint 2 — the six canonical trade verdicts.
  const commands = ([
    { label: "Buy $200 TSLAx, volume confirmed", intent: intent({ asset: "TSLAx", notionalUsd: 200, leverage: 1, rawCommand: "Buy $200 TSLAx" }), ctx: ctx() },
    { label: "Long NVDAx $500 5x, elevated vol", intent: intent({ rawCommand: "Long NVDAx $500 5x" }), ctx: ctx({ volPctile: 0.9 }) },
    { label: "Buy TSLAx on fresh news", intent: intent({ asset: "TSLAx", leverage: 1, rawCommand: "Buy TSLAx now" }), ctx: ctx({ newsShockAgeMin: 3, confirmationPresent: false }) },
    { label: "Long MSTRx 3x, BTC vol rising", intent: intent({ asset: "MSTRx", notionalUsd: 400, leverage: 3, rawCommand: "Long MSTRx 3x" }), ctx: ctx({ btcCorrelated: true, btcRealizedVolRising: true }) },
    { label: "Long NVDAx $1000 8x before earnings", intent: intent({ notionalUsd: 1000, leverage: 8, rawCommand: "Long NVDAx $1000 8x" }), ctx: ctx({ earningsWithinHours: 12, volPctile: 0.9 }) },
  ] as Array<{ label: string; intent: TradeIntent; ctx: MarketContext }>).map((c) => ({ ...c, ev: evaluateTradePermit(c.intent, c.ctx) }));

  // A REDUCE for the comparison + verification panel.
  const reduceCmd = intent({ rawCommand: "Long NVDAx $500 5x" });
  const reduceEval = evaluateTradePermit(reduceCmd, ctx({ volPctile: 0.9 }));
  const store = new PermitStore();
  const permit = issuePermit({ evaluation: reduceEval, intent: reduceCmd, priceAtIssue: 100, nowIso: NOW, seq: 1, signingKey: KEY });
  store.register(permit);
  const verified = verifyCard(permit, { signingKey: KEY });
  const tampered = { ...permit, approved_order: { ...permit.approved_order!, notionalUsd: 999999 } };
  const tamperCheck = verifyCard(tampered, { signingKey: KEY });

  return (
    <Shell title="Command Firewall" subtitle="Two checkpoints: Playbook Shield audits the strategy, the Trade-Permit Engine audits each command.">
      <div className="flex flex-col gap-6">
        <FailClosedBanner />

        <Card>
          <SectionTitle title="Checkpoint 1 — Playbook Shield" subtitle="Three strategy verdicts; Rejected emits no mandates, Restricted tightens the compiler caps." />
          <div className="flex flex-col gap-3">
            {strategies.map((s) => (
              <div key={s.label} className="flex flex-col gap-2 rounded-lg border border-line p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{s.label}</span>
                  <VerdictBadge verdict={s.audit.verdict} kind="strategy" />
                </div>
                <p className="text-xs text-ink-faint">{s.text}</p>
                {s.audit.failedChecks.length > 0 && (
                  <p className="text-xs text-ink-muted">
                    Failed: {s.audit.failedChecks.map((c) => c.check).join(", ")}
                    {s.audit.verdict === "Restricted" && ` · caps → ${s.audit.caps.risk.maxPositionPct}% pos / ${s.audit.caps.maxLeverage}x`}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle title="Checkpoint 2 — Trade-Permit Engine" subtitle="Six verdicts over ten deterministic gates." />
          <div className="grid gap-3 md:grid-cols-2">
            {commands.map((c) => (
              <div key={c.label} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
                <div>
                  <p className="text-sm font-medium">{c.label}</p>
                  {c.ev.gatesFailed.length > 0 && (
                    <p className="text-xs text-ink-faint">gates: {c.ev.gatesFailed.join(", ")}</p>
                  )}
                </div>
                <VerdictBadge verdict={c.ev.verdict} />
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle title="Original vs Warden-adjusted" subtitle="The REDUCE rewrite the engine actually permits." />
          <ComparisonColumns
            original={{ label: "Original command", rows: [["Size", "$500"], ["Leverage", "5x"], ["Order type", "market"]] }}
            adjusted={{
              label: "Warden-adjusted",
              rows: [
                ["Size", `$${reduceEval.approvedOrder?.notionalUsd}`],
                ["Leverage", `${reduceEval.approvedOrder?.leverage}x`],
                ["Order type", reduceEval.approvedOrder?.orderType ?? "—"],
              ],
            }}
            changes={reduceEval.modificationReason}
          />
        </Card>

        <Card>
          <SectionTitle title="Verification panel" subtitle="The signature/hash check the executor runs independently." />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-line p-3">
              <VerificationRow verified={verified.ok} permitId={permit.permit_id} jsonHash={permit.json_hash.slice(0, 24) + "…"} status={`verdict ${permit.verdict} · chain intact`} />
            </div>
            <div className="rounded-lg border border-line p-3">
              <VerificationRow verified={tamperCheck.ok} permitId={permit.permit_id} jsonHash={"(field altered)"} status={`tamper demo · ${tamperCheck.reason ?? ""}`} />
            </div>
          </div>
        </Card>
      </div>
    </Shell>
  );
}
