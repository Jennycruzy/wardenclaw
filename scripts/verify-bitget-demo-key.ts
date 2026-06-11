/**
 * Verifies whether the configured Bitget API key works in Demo Trading mode
 * (paptrading: 1) by calling an authenticated spot endpoint through the
 * official Agent Hub MCP server. Read-only in effect: it only lists orders,
 * never places one.
 *
 * Verified finding (2026-06-11, Bitget support article 12560603790031 + live
 * tests): Bitget Demo Trading is FUTURES-ONLY. Spot endpoints return
 * "exchange environment is incorrect" (40099) under paptrading regardless of
 * key type, so official demo execution of spot xStocks is impossible — the
 * internal paper engine on real market data is the supported path.
 *
 *   pnpm tsx scripts/verify-bitget-demo-key.ts
 */
import "dotenv/config";
import { BitgetMcpClient } from "@wardenclaw/bitget-adapter";

async function probe(paperTrading: boolean): Promise<string> {
  const client = new BitgetMcpClient({
    modules: "spot",
    // The MCP server forbids --read-only together with --paper-trading.
    readOnly: !paperTrading,
    paperTrading,
    apiKey: process.env.BITGET_API_KEY,
    secretKey: process.env.BITGET_API_SECRET,
    passphrase: process.env.BITGET_API_PASSPHRASE,
    timeoutMs: 25000,
  });
  try {
    const res = await client.callTool<{ ok?: boolean }>("spot_get_orders", { symbol: "BTCUSDT" });
    return res?.ok ? "ok" : "rejected";
  } catch (err) {
    return `error: ${(err as Error).message.slice(0, 160)}`;
  } finally {
    await client.stop();
  }
}

async function main(): Promise<void> {
  if (!process.env.BITGET_API_KEY || !process.env.BITGET_API_SECRET || !process.env.BITGET_API_PASSPHRASE) {
    console.error("Set BITGET_API_KEY/_SECRET/_PASSPHRASE in .env first.");
    process.exitCode = 1;
    return;
  }
  const demo = await probe(true);
  const live = await probe(false);
  console.log(`demo environment (paptrading: 1): ${demo}`);
  console.log(`live environment (read-only):     ${live}`);
  if (demo === "ok") {
    console.log("→ key works in Demo Trading mode.");
  } else if (live === "ok") {
    console.log(
      "→ key authenticates LIVE but not in demo. Either it was created outside demo " +
        "mode, or the endpoint is spot (Bitget demo trading is futures-only).",
    );
  } else {
    console.log("→ key failed in both environments — check the credentials.");
  }
}

main();
