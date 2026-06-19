/**
 * demo_closeonly — the CLOSE-ONLY survival contrast (paper / sim only).
 *
 * Canonical fixture: a BTC-correlated 6x long while BTC realized vol spikes.
 * The watcher flips the account to CLOSE-ONLY, then:
 *   "buy more"   → BLOCKED (exposure increase refused)
 *   "reduce 50%" → APPROVED + executed (paper)
 *
 *   pnpm demo:closeonly
 */

import {
  CloseOnlyController,
  evaluateTradePermit,
  issuePermit,
  PermitStore,
  WardenExecutor,
  makeDeterministicPaperFill,
  type TradeIntent,
  type MarketContext,
  type OpenPositionState,
} from "@wardenclaw/core";

const KEY = process.env.WARDEN_SIGNING_KEY ?? "wardenclaw-demo-key";
const NOW = "2026-06-19T15:00:00.000Z";
const PRICE = 100;

const position: OpenPositionState = { asset: "MSTRx", btcCorrelated: true, leverage: 6, entryPrice: 100, currentPrice: PRICE };

function ctx(over: Partial<MarketContext> = {}): MarketContext {
  return {
    nowIso: NOW, knownAsset: true, btcCorrelated: true, price: PRICE, underlyingRefPrice: PRICE,
    spreadBps: 10, volPctile: 0.4, confirmationPresent: true, marketOpen: true,
    btcRealizedVolRising: true, feedAgeSec: 5, ...over,
  };
}
function intent(over: Partial<TradeIntent>): TradeIntent {
  return {
    asset: "MSTRx", direction: "long", notionalUsd: 200, leverage: 3,
    orderType: "market", triggerSource: "human", rawCommand: "", ...over,
  };
}

function main(): void {
  console.log("\n========================================================");
  console.log("  WARDENCLAW — CLOSE-ONLY SURVIVAL DEMO   (PAPER / SIM)");
  console.log("========================================================");

  // 1. Watcher trips on the correlated 6x long + BTC vol spike.
  const watcher = new CloseOnlyController(undefined, KEY);
  const { assessment, card } = watcher.update(
    [position],
    { btcRealizedVolRising: true, fundingDeteriorating: false },
    NOW,
  );
  console.log(`  Watcher: CLOSE-ONLY ${assessment.active ? "ENGAGED" : "inactive"}  triggers=[${assessment.triggers.join(", ")}]`);
  console.log(`           card ${card?.transition} ${card?.permit_id ?? card?.json_hash.slice(0, 12)}`);
  for (const r of assessment.reasons) console.log(`           - ${r}`);
  console.log("--------------------------------------------------------");

  const store = new PermitStore();
  const executor = new WardenExecutor(store, makeDeterministicPaperFill(), { signingKey: KEY });

  // 2. "buy more" — exposure increase — is BLOCKED while CLOSE-ONLY.
  const buyMore = intent({ direction: "long", rawCommand: "Buy more MSTRx", notionalUsd: 200 });
  const buyVerdict = evaluateTradePermit(buyMore, ctx({ closeOnlyActive: watcher.isActive }));
  console.log(`  Command "buy more"   → verdict ${buyVerdict.verdict}  (exposure increase refused)`);

  // 3. "reduce 50%" — risk-reducing — is APPROVED and executes (paper).
  const reduce = intent({ direction: "reduce", rawCommand: "Reduce MSTRx 50%", notionalUsd: 100 });
  const reduceVerdict = evaluateTradePermit(reduce, ctx({ closeOnlyActive: watcher.isActive }));
  let line = `  Command "reduce 50%" → verdict ${reduceVerdict.verdict}`;
  if (reduceVerdict.verdict === "APPROVE" || reduceVerdict.verdict === "REDUCE") {
    const permit = issuePermit({ evaluation: reduceVerdict, intent: reduce, priceAtIssue: PRICE, nowIso: NOW, seq: 1, signingKey: KEY });
    store.register(permit);
    const r = executor.execute({ permit, currentPrice: PRICE, nowIso: NOW, requestedAction: "reduce", closeOnlyActive: watcher.isActive });
    line += r.accepted ? `  → EXECUTED (paper), ${r.fills.length} fill(s)` : `  → ${r.reason}`;
  }
  console.log(line);

  console.log("--------------------------------------------------------");
  console.log("  Survival mode lets you de-risk but never add risk. Paper only.");
  console.log("========================================================\n");
}

main();
