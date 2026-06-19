/**
 * demo_bypass — the single most important demo (~30s, screenshot-able).
 *
 * A firewall is only real if the execution path cannot be reached around it.
 * This drives the sim executor through five attempts and prints a clean,
 * numbered, paper-labeled transcript:
 *   1. no permit          → REJECTED: no permit
 *   2. expired permit     → REJECTED: expired
 *   3. tampered permit    → REJECTED: signature/hash mismatch
 *   4. replayed permit    → REJECTED: already consumed
 *   5. fresh valid permit → EXECUTED (paper)
 *
 *   pnpm demo:bypass
 */

import {
  WardenExecutor,
  PermitStore,
  issuePermit,
  evaluateTradePermit,
  makeDeterministicPaperFill,
  tamperPermit,
  type TradeIntent,
  type MarketContext,
} from "@wardenclaw/core";

const KEY = process.env.WARDEN_SIGNING_KEY ?? "wardenclaw-demo-key";
const ISSUE = "2026-06-19T15:00:00.000Z";
const PRICE = 100;

const intent: TradeIntent = {
  asset: "TSLAx", direction: "long", notionalUsd: 200, leverage: 1,
  orderType: "market", triggerSource: "human", rawCommand: "Buy $200 TSLAx after open if volume confirms",
};
const ctx: MarketContext = {
  nowIso: ISSUE, knownAsset: true, btcCorrelated: false, price: PRICE, underlyingRefPrice: PRICE,
  spreadBps: 10, volPctile: 0.3, confirmationPresent: true, marketOpen: true,
  btcRealizedVolRising: false, feedAgeSec: 5, closeOnlyActive: false,
};

function line(n: number, title: string, r: { accepted: boolean; reason?: string; detail?: string; fills: unknown[] }): void {
  const status = r.accepted ? "EXECUTED (paper)" : `REJECTED: ${r.reason}`;
  const tail = r.accepted ? `${r.fills.length} paper fill(s)` : (r.detail ?? "");
  console.log(`  ${n}. ${title.padEnd(34)} → ${status}${tail ? `  [${tail}]` : ""}`);
}

function main(): void {
  const evaluation = evaluateTradePermit(intent, ctx);
  const store = new PermitStore();
  const valid = issuePermit({ evaluation, intent, priceAtIssue: PRICE, nowIso: ISSUE, seq: 1, signingKey: KEY });
  store.register(valid);
  const executor = new WardenExecutor(store, makeDeterministicPaperFill(), { signingKey: KEY });

  console.log("\n========================================================");
  console.log("  WARDENCLAW — EXECUTOR BYPASS DEMO   (PAPER / SIM ONLY)");
  console.log("  \"No valid Warden Permit = no execution.\"");
  console.log("========================================================");
  console.log(`  Permit: ${valid.permit_id}  verdict=${valid.verdict}  expires=${valid.expires_at}`);
  console.log("--------------------------------------------------------");

  // 1. Agent calls the executor directly with no permit.
  line(1, "agent calls executor, no permit", executor.execute({ currentPrice: PRICE, nowIso: ISSUE, requestedAction: "long" }));

  // 2. Expired permit (evaluate one hour after expiry).
  line(2, "expired permit", executor.execute({ permit: valid, currentPrice: PRICE, nowIso: "2026-06-19T18:00:00.000Z", requestedAction: "long" }));

  // 3. Tampered permit (one field altered).
  line(3, "tampered permit (field altered)", executor.execute({ permit: tamperPermit(valid), currentPrice: PRICE, nowIso: ISSUE, requestedAction: "long" }));

  // 5-as-4 setup: first consume the valid permit with a good execution, then replay it.
  const firstUse = executor.execute({ permit: valid, currentPrice: PRICE, nowIso: ISSUE, requestedAction: "long" });
  // 4. Replayed consumed permit.
  line(4, "replayed consumed permit", executor.execute({ permit: valid, currentPrice: PRICE, nowIso: ISSUE, requestedAction: "long" }));

  // 5. The fresh valid permit (its first, accepted use).
  line(5, "fresh valid permit", firstUse);

  console.log("--------------------------------------------------------");
  const accepted = executor.attempts.filter((a) => a.accepted).length;
  console.log(`  Summary: ${executor.attempts.length} attempts, ${accepted} executed (paper), ${executor.attempts.length - accepted} refused.`);
  console.log("  Every refusal came from the executor's own independent permit check.");
  console.log("========================================================\n");
}

main();
