/**
 * verify:perception — proves the live Bitget perception → gate inputs wiring end
 * to end against REAL public Bitget market data (no keys needed). Fetches the
 * ticker + candles for the universe, assembles the MarketContext, and runs a
 * sample command through the Trade-Permit Engine. Fails loud if a symbol returns
 * no data — never fabricates.
 *
 *   pnpm verify:perception
 */

import {
  BitgetPublicMarketData,
  gatherPerception,
  TRADEABLE_XSTOCKS,
} from "@wardenclaw/bitget-adapter";
import { evaluateTradePermit, type TradeIntent } from "@wardenclaw/core";

async function main(): Promise<void> {
  const source = new BitgetPublicMarketData();
  const nowMs = Date.now();
  console.log("\n=========== LIVE BITGET PERCEPTION → GATE INPUTS ===========");
  console.log(`  source: ${source.mode} · ${new Date(nowMs).toISOString()}\n`);

  for (const symbol of TRADEABLE_XSTOCKS) {
    try {
      const ctx = await gatherPerception(source, symbol, { nowMs });
      const intent: TradeIntent = {
        asset: symbol.display, direction: "long", notionalUsd: 300, leverage: 3,
        orderType: "market", triggerSource: "human", rawCommand: `Long ${symbol.display} $300 3x`,
      };
      const v = evaluateTradePermit(intent, ctx);
      console.log(
        `  ${symbol.display.padEnd(6)} ${symbol.bitgetSymbol.padEnd(11)} ` +
          `price=${ctx.price.toFixed(2).padStart(9)} vol%=${(ctx.volPctile * 100).toFixed(0).padStart(3)} ` +
          `open=${ctx.marketOpen ? "Y" : "N"} feed=${ctx.feedAgeSec.toFixed(0)}s ` +
          `btc=${ctx.btcCorrelated ? "Y" : "N"} → verdict ${v.verdict}` +
          (v.gatesFailed.length ? `  [${v.gatesFailed.join(",")}]` : ""),
      );
    } catch (err) {
      console.log(`  ${symbol.display.padEnd(6)} ERROR: ${(err as Error).message}`);
    }
  }
  console.log("\n  Every value above is real Bitget public data → deterministic gate inputs.");
  console.log("===========================================================\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
