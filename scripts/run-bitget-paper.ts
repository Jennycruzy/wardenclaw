/**
 * Run the WARDENCLAW Stocks reactor in paper mode against REAL Bitget public
 * market data. This pulls live candles/tickers for the xStock universe, tracks
 * shock/cooldown state across polling cycles, and paper-trades the confirmed
 * continuation through the internal paper engine.
 *
 * It NEVER fabricates data: if a symbol returns no data from Bitget (xStock
 * symbols may use a convention this build hasn't verified), it logs the failure
 * loudly and skips that asset rather than inventing a price.
 *
 *   pnpm run:bitget-paper
 *
 * Env:
 *   BITGET_PUBLIC_BASE_URL   (default https://api.bitget.com)
 *   BITGET_CANDLE_GRANULARITY (default 5min)
 *   BITGET_POLL_SECONDS      (default 60)
 *   BITGET_CYCLES            (default 1 — number of poll cycles to run)
 */

import "dotenv/config";

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseEnv } from "dotenv";
import { AuditLogger, appendMandate, createLlmProvider } from "@wardenclaw/core";
import {
  BitgetPublicMarketData,
  BitgetMcpClient,
  BitgetMcpMarketData,
  BitgetMcpAgentHub,
  type MarketDataSource,
  BitgetReactorAgent,
  PaperBook,
  DEFAULT_BITGET_AGENT_CONFIG,
  OfficialBitgetDemoExecutor,
  demoCredentialsFromEnv,
  missingDemoCredentials,
  findXStock,
  TRADEABLE_XSTOCKS,
  INDEX_PROXIES,
  detectShock,
  reactorConfigFromEnv,
  isTickerStale,
  selectExecutionMode,
  YahooFinanceNewsFeed,
  CachedNewsScanner,
  type AssetPerception,
  type ShockDetection,
  type BitgetAgentConfig,
} from "@wardenclaw/bitget-adapter";

const granularity = process.env.BITGET_CANDLE_GRANULARITY ?? "5min";
const pollSeconds = Number(process.env.BITGET_POLL_SECONDS ?? "60");
const cycles = Number(process.env.BITGET_CYCLES ?? "1");
const STALE_MS = 10 * 60_000;

/**
 * Live kill-switch. Re-reads .env on each cycle so flipping REACTOR_PAUSED
 * pauses/resumes mandate generation without restarting the process.
 * Accepts 1/true/yes/on (case-insensitive); anything else means "running".
 */
function reactorPaused(): boolean {
  let raw = process.env.REACTOR_PAUSED ?? "";
  try {
    const env = parseEnv(readFileSync(join(process.cwd(), ".env")));
    if (env.REACTOR_PAUSED !== undefined) raw = env.REACTOR_PAUSED;
  } catch {
    // .env not present — fall back to the value loaded at startup.
  }
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

interface ShockState {
  barsSinceShock: number | null;
  armedShock?: ShockDetection;
}

async function main(): Promise<void> {
  // Perception source: the official Bitget Agent Hub MCP server when enabled
  // (BITGET_AGENT_HUB_MCP=true), otherwise the public REST client. Both are real
  // and fail loud; neither fabricates a price.
  const useMcp = process.env.BITGET_AGENT_HUB_MCP === "true";
  let mcpClient: BitgetMcpClient | undefined;
  let md: MarketDataSource;
  if (useMcp) {
    mcpClient = new BitgetMcpClient({
      modules: "spot,futures",
      readOnly: true,
      apiKey: process.env.BITGET_API_KEY,
      secretKey: process.env.BITGET_API_SECRET,
      passphrase: process.env.BITGET_API_PASSPHRASE,
    });
    await mcpClient.start();
    md = new BitgetMcpMarketData(mcpClient);
  } else {
    md = new BitgetPublicMarketData({ baseUrl: process.env.BITGET_PUBLIC_BASE_URL });
  }
  console.log(`[bitget] perception source: ${md.mode}`);
  // Real market-wide risk backdrop from the Agent Hub futures Skill (BTC funding
  // + open interest). Crypto-derived, used only to modulate equity entries.
  const agentHub = mcpClient ? new BitgetMcpAgentHub(mcpClient) : undefined;
  const auditDir = join(process.cwd(), "data", "audit");
  mkdirSync(auditDir, { recursive: true });
  const runId = `bitget-paper-${Date.now()}`;
  const auditPath = join(auditDir, `${runId}.jsonl`);
  const mandatesPath = join(auditDir, `${runId}.mandates.jsonl`);
  const audit = new AuditLogger(auditPath);
  const book = new PaperBook(10_000);

  // Official Bitget Demo Trading (§4.3 priority 1): activates only when the env
  // requests it AND the full Demo Trading API credential set is present.
  const wantOfficialDemo = process.env.BITGET_EXECUTION_MODE === "official_bitget_demo";
  const demoCreds = demoCredentialsFromEnv();
  if (wantOfficialDemo && !demoCreds) {
    console.error(
      `[bitget] BITGET_EXECUTION_MODE=official_bitget_demo but missing: ` +
        `${missingDemoCredentials().join(", ")}. Create a Demo Trading API key in ` +
        `Bitget's demo-trading section and set all three. Falling back to the ` +
        `internal paper engine (clearly labeled) for this run.`,
    );
  }
  const officialDemoVerified = wantOfficialDemo && Boolean(demoCreds);
  const mode = selectExecutionMode({ officialDemoVerified, backtest: false });
  console.log(`[bitget] execution mode: ${mode.mode} — ${mode.reason}`);

  let demoClient: BitgetMcpClient | undefined;
  let demoExecutor: OfficialBitgetDemoExecutor | undefined;
  if (mode.mode === "official_bitget_demo") {
    ({ executor: demoExecutor, client: demoClient } = OfficialBitgetDemoExecutor.spawn(demoCreds));
  }

  // Reactor thresholds: env-overridable, calibrated by calibrate-bitget-reactor.
  const reactor = reactorConfigFromEnv();
  console.log(
    `[bitget] reactor thresholds: shock ≥${(reactor.shock.minMagnitudePct * 100).toFixed(1)}% ` +
      `over ${reactor.shock.windowBars} bars, volume ≥${reactor.shock.minVolumeRatio}×, ` +
      `cooldown ${reactor.cooldownBars} bars, entry score ≥${reactor.minEntryScore}, ` +
      `take-profit +${((reactor.takeProfitPct ?? 0) * 100).toFixed(1)}%, max hold ${reactor.maxHoldBars} bars`,
  );
  const cfg: BitgetAgentConfig = {
    ...DEFAULT_BITGET_AGENT_CONFIG,
    reactor,
    executionMode: mode.mode,
    compiledStrategy: {},
  };
  const agent = new BitgetReactorAgent(cfg, book, audit, auditPath, undefined, {
    demoExecutor,
    symbolFor: (asset) => {
      const sym = findXStock(asset);
      if (!sym) throw new Error(`no Bitget symbol mapping for ${asset}`);
      return sym.bitgetSymbol;
    },
  });
  const state = new Map<string, ShockState>();

  // Real per-equity news (Yahoo Finance RSS for the underlying US stock),
  // classified by the configured LLM into the reactor's sentiment gate.
  // Disable with BITGET_NEWS_FEED=false; without an LLM the event is simply
  // absent and the deterministic gates run alone (honest absence).
  let newsScanner: CachedNewsScanner | null = null;
  if (process.env.BITGET_NEWS_FEED !== "false") {
    const llm = createLlmProvider(process.env, process.env.NEWS_SENTIMENT_MODEL || undefined);
    newsScanner = new CachedNewsScanner(new YahooFinanceNewsFeed(), llm, {
      ttlSeconds: Number(process.env.BITGET_NEWS_TTL_SECONDS ?? "300"),
    });
    console.log(
      `[bitget] news feed: yahoo_finance_rss · classifier: ${
        newsScanner.classifierEnabled ? llm.name : "disabled (no event, deterministic gates only)"
      }`,
    );
  }

  for (let cycle = 0; cycle < cycles; cycle++) {
    // Index support from the proxies (QQQx/SPYx) — real data only.
    let indexSupport = 0.5;
    try {
      const proxy = INDEX_PROXIES[0]!;
      const t = await md.getTicker(proxy.bitgetSymbol);
      const span = t.high24h - t.low24h || 1;
      indexSupport = Math.max(0, Math.min(1, (t.lastPrice - t.low24h) / span));
    } catch (err) {
      console.warn(`[bitget] index proxy unavailable: ${(err as Error).message}`);
    }

    // Blend in the real derivatives risk backdrop (Agent Hub funding/OI Skill).
    if (agentHub) {
      try {
        const d = await agentHub.getDerivativesSentiment("BTCUSDT");
        const macroSupport = Math.max(0, Math.min(1, (d.score + 1) / 2));
        const blended = 0.7 * indexSupport + 0.3 * macroSupport;
        console.log(
          `[bitget] risk backdrop: regime=${d.regime} score=${d.score.toFixed(2)} ` +
            `(BTC funding=${d.fundingRate}, OI=${d.openInterest}) → indexSupport ${indexSupport.toFixed(2)}→${blended.toFixed(2)}`,
        );
        indexSupport = blended;
      } catch (err) {
        console.warn(`[bitget] risk backdrop unavailable: ${(err as Error).message}`);
      }
    }

    const perceptions: AssetPerception[] = [];
    const now = Date.now();
    for (const sym of TRADEABLE_XSTOCKS) {
      try {
        const [ticker, candles] = await Promise.all([
          md.getTicker(sym.bitgetSymbol),
          md.getCandles(sym.bitgetSymbol, granularity, 50),
        ]);
        const st = state.get(sym.display) ?? { barsSinceShock: null };
        const shock = detectShock(candles, reactor.shock);
        if (shock.isShock && st.barsSinceShock === null) {
          st.barsSinceShock = 0;
          st.armedShock = shock;
        } else if (st.barsSinceShock !== null) {
          st.barsSinceShock += 1;
        }
        state.set(sym.display, st);

        let event;
        if (newsScanner) {
          try {
            const scanned = await newsScanner.scan(sym.underlying, sym.display);
            event = scanned.event;
            if (scanned.items.length > 0) {
              console.log(
                `[bitget] ${sym.display} news: ${scanned.items.length} real headlines` +
                  (event ? ` → ${event.direction} (${(event.confidence * 100).toFixed(0)}%)` : " (unclassified)"),
              );
            }
            if (newsScanner.lastError) {
              console.warn(`[bitget] news classifier degraded: ${newsScanner.lastError}`);
            }
          } catch (err) {
            console.warn(`[bitget] ${sym.display} news unavailable: ${(err as Error).message}`);
          }
        }

        perceptions.push({
          asset: sym.display,
          bars: candles,
          barsSinceShock: st.barsSinceShock,
          armedShock: st.armedShock,
          midPrice: ticker.lastPrice,
          marketDataTimestamp: ticker.timestamp,
          event,
          indexSupport,
          feedStale: isTickerStale(ticker, now, STALE_MS),
        });
      } catch (err) {
        console.warn(`[bitget] ${sym.display} skipped (real data unavailable): ${(err as Error).message}`);
      }
    }

    if (perceptions.length === 0) {
      console.error(
        "[bitget] no xStock data resolved. Verify the Bitget xStock symbol convention " +
          "in packages/bitget-adapter/src/universe.ts before paper trading.",
      );
    } else if (reactorPaused()) {
      console.log(
        `[bitget] cycle ${cycle + 1}/${cycles}: PAUSED via REACTOR_PAUSED — perception only, ` +
          `no mandates generated (set REACTOR_PAUSED=false in .env to resume)`,
      );
    } else {
      const result = await agent.runCycle(perceptions);
      for (const mandate of result.mandates) {
        await appendMandate(mandatesPath, mandate);
      }
      for (const exit of result.exits) {
        console.log(
          `[bitget] EXIT ${exit.asset} (${exit.reason}): entry ${exit.entryPrice} → exit ${exit.exitPrice}, ` +
            `pnl $${exit.pnlUsd.toFixed(2)} (${exit.pnlPct.toFixed(2)}%)`,
        );
      }
      console.log(
        `[bitget] cycle ${cycle + 1}/${cycles}: evaluated ${result.mandates.length}, ` +
          `executed ${result.executedAsset ?? "none"}, equity ~$${book
            .equity(Object.fromEntries(perceptions.map((p) => [p.asset, p.midPrice])))
            .toFixed(2)}`,
      );
    }

    if (cycle < cycles - 1) {
      await new Promise((r) => setTimeout(r, pollSeconds * 1000));
    }
  }

  console.log(`[bitget] audit trail: ${auditPath}`);
  console.log(`[bitget] mandates:    ${mandatesPath}`);
  await mcpClient?.stop();
  await demoClient?.stop();
}

main().catch((err) => {
  console.error("[bitget] fatal:", err);
  process.exitCode = 1;
});
