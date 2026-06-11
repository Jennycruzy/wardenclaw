/**
 * Proves the live Bitget Agent Hub MCP integration end-to-end: spawns the
 * official bitget-mcp-server, lists its real tools, and fetches a live ticker +
 * candles through the Agent Hub. Read-only, public endpoints — no keys required,
 * no orders placed.
 *
 *   pnpm verify:bitget-hub
 */
import "dotenv/config";
import { BitgetMcpClient, BitgetMcpMarketData } from "@wardenclaw/bitget-adapter";

const symbol = process.env.BITGET_VERIFY_SYMBOL ?? "BTCUSDT";

async function main(): Promise<void> {
  const client = new BitgetMcpClient({
    modules: "spot,futures",
    readOnly: true,
    apiKey: process.env.BITGET_API_KEY,
    secretKey: process.env.BITGET_API_SECRET,
    passphrase: process.env.BITGET_API_PASSPHRASE,
    timeoutMs: 25000,
  });
  try {
    const tools = await client.listTools();
    console.log(`✅ Bitget Agent Hub MCP up — ${tools.length} tools exposed`);
    console.log(`   sample: ${tools.slice(0, 6).map((t) => t.name).join(", ")}…`);

    const md = new BitgetMcpMarketData(client);
    const t = await md.getTicker(symbol);
    console.log(`✅ live ticker via Agent Hub MCP → ${symbol} last=${t.lastPrice} @ ${t.timestamp}`);
    const c = await md.getCandles(symbol, "1min", 3);
    console.log(`✅ live candles via Agent Hub MCP → ${c.length} bars, latest close=${c[c.length - 1].close}`);
    console.log("Perception now flows through the official Bitget Agent Hub in real time.");
  } catch (err) {
    console.error(`✗ Bitget Agent Hub MCP verify failed: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await client.stop();
  }
}

main();
