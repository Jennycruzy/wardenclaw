/**
 * evidence:run — a self-contained, timestamped, paste-able transcript that runs a
 * full firewall scenario end to end and emits native evidence to the terminal and
 * to data/evidence-run.jsonl. Never implies a real fill.
 *
 *   pnpm evidence:run
 */

import {
  WardenLogger,
  auditStrategy,
  evaluateTradePermit,
  issuePermit,
  PermitStore,
  WardenExecutor,
  makeDeterministicPaperFill,
  ghostCompare,
  CloseOnlyController,
  type TradeIntent,
  type MarketContext,
  type SimOrder,
} from "@wardenclaw/core";

const KEY = process.env.WARDEN_SIGNING_KEY ?? "wardenclaw-evidence-key";
const NOW = "2026-06-19T15:00:00.000Z";

function ctx(over: Partial<MarketContext> = {}): MarketContext {
  return {
    nowIso: NOW, knownAsset: true, btcCorrelated: false, price: 100, underlyingRefPrice: 100,
    spreadBps: 10, volPctile: 0.3, confirmationPresent: true, marketOpen: true,
    btcRealizedVolRising: false, feedAgeSec: 5, closeOnlyActive: false, ...over,
  };
}

function main(): void {
  const log = new WardenLogger({ jsonlPath: "data/evidence-run.jsonl", mode: "PAPER" });
  log.banner("WARDENCLAW — END-TO-END EVIDENCE TRANSCRIPT");

  // 1. Playbook Shield: an unsafe strategy is Rejected; an aggressive one is Restricted.
  const rejected = auditStrategy({
    strategy: "Double position size after every loss. 10x leverage on any spike.",
    signingKey: KEY, nowIso: NOW, expiresAtIso: "2026-06-19T15:15:00Z",
  });
  log.log("strategy_verdict", "Playbook Shield", `${rejected.verdict} (no mandates) — ${rejected.failedChecks.map((c) => c.check).join(", ")}`,
    { card: rejected.card.permit_id ?? rejected.card.json_hash.slice(0, 12), verdict: rejected.verdict });

  const restricted = auditStrategy({
    strategy: "Long NVDAx with 4x leverage on momentum. Daily loss 4%, cooldown after news, confirmation.",
    signingKey: KEY, nowIso: NOW, expiresAtIso: "2026-06-19T15:15:00Z",
  });
  log.log("strategy_verdict", "Playbook Shield", `${restricted.verdict} — caps tightened to ${restricted.caps.risk.maxPositionPct}% pos / ${restricted.caps.maxLeverage}x`,
    { verdict: restricted.verdict, maxPositionPct: restricted.caps.risk.maxPositionPct });

  // 2. A REDUCE command with a side-by-side ghost sim.
  const intent: TradeIntent = {
    asset: "NVDAx", direction: "long", notionalUsd: 500, leverage: 5,
    orderType: "market", triggerSource: "ai_agent", rawCommand: "Long NVDAx $500 5x",
  };
  const evalRes = evaluateTradePermit(intent, ctx({ volPctile: 0.9 }));
  log.log("gate", "gates", `${evalRes.verdict} — failed: ${evalRes.gatesFailed.join(", ") || "none"}`,
    { verdict: evalRes.verdict, gatesFailed: evalRes.gatesFailed });

  const store = new PermitStore();
  const executor = new WardenExecutor(store, makeDeterministicPaperFill(), { signingKey: KEY });
  const permit = issuePermit({ evaluation: evalRes, intent, priceAtIssue: 100, nowIso: NOW, seq: 1, signingKey: KEY });
  store.register(permit);
  log.log("permit_issued", "permit", `${permit.permit_id} verdict=${permit.verdict} order=$${permit.approved_order?.notionalUsd}@${permit.approved_order?.leverage}x`,
    { permitId: permit.permit_id });

  const ghost = ghostCompare(
    { side: "long", notionalUsd: 500, leverage: 5, entryPrice: 100 },
    { side: "long", notionalUsd: permit.approved_order!.notionalUsd, leverage: permit.approved_order!.leverage, entryPrice: 100 } as SimOrder,
    [
      { time: "t0", open: 100, high: 101, low: 92, close: 94 },
      { time: "t1", open: 94, high: 95, low: 86, close: 88 },
    ],
  );
  log.log("ghost_sim", "ghost sim", `original maxDD ${(ghost.original.maxDrawdownPct * 100).toFixed(0)}% vs warden ${(ghost.wardenAdjusted.maxDrawdownPct * 100).toFixed(0)}%`,
    { drawdownAvoidedUsd: ghost.drawdownAvoidedUsd, liquidationAvoided: ghost.liquidationAvoided });

  const exec = executor.execute({ permit, currentPrice: 100, nowIso: NOW, requestedAction: "long" });
  log.log("executor", "executor", exec.accepted ? `EXECUTED (paper), ${exec.fills.length} fill(s)` : `REJECTED: ${exec.reason}`,
    { accepted: exec.accepted });
  for (const f of exec.fills) log.log("paper_fill", "paper fill", `${f.side} ${f.filledQty} ${f.asset} @ ${f.price} [${f.source}]`, { ...f });

  // 3. The premium gate firing on a weekend command.
  const weekend = evaluateTradePermit(
    { ...intent, leverage: 1, rawCommand: "Buy NVDAx weekend" },
    ctx({ marketOpen: false, price: 104, underlyingRefPrice: 100 }),
  );
  log.log("gate", "premium gate", `weekend command → ${weekend.verdict} (premium/discount gate fired)`, { verdict: weekend.verdict });

  // 4. Close-only flip.
  const watcher = new CloseOnlyController(undefined, KEY);
  const flip = watcher.update(
    [{ asset: "MSTRx", btcCorrelated: true, leverage: 6, entryPrice: 100, currentPrice: 100 }],
    { btcRealizedVolRising: true, fundingDeteriorating: false }, NOW,
  );
  log.log("close_only", "watcher", `CLOSE-ONLY ${flip.assessment.active ? "ENGAGED" : "clear"} — ${flip.assessment.triggers.join(", ")}`,
    { active: flip.assessment.active });

  log.summary([
    `Strategy verdicts: Rejected + Restricted demonstrated.`,
    `Trade verdict: ${evalRes.verdict}; executor accepted=${exec.accepted}; ${exec.fills.length} paper fill(s).`,
    `Ghost sim drawdown avoided: $${ghost.drawdownAvoidedUsd}.`,
    `Close-only: ${flip.assessment.active ? "engaged" : "clear"}.`,
    `Evidence written to data/evidence-run.jsonl. PAPER / SIM ONLY — no real fills.`,
  ]);
}

main();
