/**
 * WARDENCLAW Stocks — interactive live console.
 *
 * A full-screen terminal cockpit for the xStock reactor: it scans REAL Bitget
 * market data for the whole universe, shows shock/cooldown state per symbol,
 * the news/sentiment backdrop, the paper book, and a scrolling event feed —
 * and it is interactive, not watch-only:
 *
 *   [space] pause / resume scanning      [f] force a scan now
 *   [t]     toggle trading (paper exec)  [x] close all open paper positions
 *   [+ / -] poll interval                [q] quit
 *
 * Perception and execution are the same real adapters the paper agent uses
 * (public REST or the official Agent Hub MCP); mandates and the hash-chained
 * audit trail land in data/audit/ so the /bitget dashboard reflects this run.
 * Nothing here fabricates a price: a symbol that returns no data is shown as
 * an error row, never invented.
 *
 *   pnpm console:bitget
 */

import "dotenv/config";

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { AuditLogger, appendMandate } from "@wardenclaw/core";
import {
  BitgetPublicMarketData,
  BitgetMcpClient,
  BitgetMcpMarketData,
  BitgetMcpAgentHub,
  type MarketDataSource,
  BitgetReactorAgent,
  PaperBook,
  DEFAULT_BITGET_AGENT_CONFIG,
  TRADEABLE_XSTOCKS,
  INDEX_PROXIES,
  detectShock,
  evaluateReactor,
  technicalDirection,
  reactorConfigFromEnv,
  isTickerStale,
  type AssetPerception,
  type ShockDetection,
  type BitgetAgentConfig,
  type BitgetCandle,
  type DerivativesSentiment,
} from "@wardenclaw/bitget-adapter";

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const ESC = "[";
const reset = `${ESC}0m`;
const bold = (s: string) => `${ESC}1m${s}${reset}`;
const dim = (s: string) => `${ESC}2m${s}${reset}`;
const green = (s: string) => `${ESC}38;5;118m${s}${reset}`; // neon green (dashboard accent)
const red = (s: string) => `${ESC}38;5;203m${s}${reset}`;
const yellow = (s: string) => `${ESC}38;5;221m${s}${reset}`;
const cyan = (s: string) => `${ESC}38;5;87m${s}${reset}`;
const gray = (s: string) => `${ESC}38;5;245m${s}${reset}`;
const inverse = (s: string) => `${ESC}7m${s}${reset}`;

const stripAnsi = (s: string) => s.replace(/\[[0-9;]*m/g, "");
const visLen = (s: string) => stripAnsi(s).length;
const padEndV = (s: string, n: number) => s + " ".repeat(Math.max(0, n - visLen(s)));
const padStartV = (s: string, n: number) => " ".repeat(Math.max(0, n - visLen(s))) + s;

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n: number, digits = 2): string {
  const s = `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
  return n > 0 ? green(s) : n < 0 ? red(s) : gray(s);
}
function hhmmss(d = new Date()): string {
  return d.toISOString().slice(11, 19);
}

// ── State ─────────────────────────────────────────────────────────────────────

interface ShockState {
  barsSinceShock: number | null;
  armedShock?: ShockDetection;
}

interface SymbolRow {
  display: string;
  bitgetSymbol: string;
  price?: number;
  change24hPct?: number;
  bars?: BitgetCandle[];
  shock?: ShockDetection;
  state: string; // rendered state cell
  detail: string; // rendered reason cell
  error?: string;
}

interface EventLine {
  time: string;
  text: string;
}

const granularity = process.env.BITGET_CANDLE_GRANULARITY ?? "5min";
const STALE_MS = 10 * 60_000;
const MAX_EVENTS = 200;

let pollSeconds = Math.max(10, Number(process.env.BITGET_POLL_SECONDS ?? "30"));
let paused = false;
let tradingEnabled = true;
let scanning = false;
let scanningSymbol: string | null = null;
let nextScanAt = Date.now();
let cycle = 0;
let spinnerIdx = 0;
let quitting = false;

const rows = new Map<string, SymbolRow>();
const shockState = new Map<string, ShockState>();
const events: EventLine[] = [];
let indexSupport = 0.5;
let indexSupportSource = "n/a";
let derivBackdrop: DerivativesSentiment | null = null;
let newsStatus =
  "per-equity news feed: not configured — honest absence, sentiment gate stays neutral";
let lastPrices: Record<string, number> = {};
let forceScan: (() => void) | null = null;

function pushEvent(text: string): void {
  events.push({ time: hhmmss(), text });
  if (events.length > MAX_EVENTS) events.shift();
  // Headless (no TTY): degrade to plain line logging so the console still
  // works under pm2 / nohup / CI.
  if (!process.stdout.isTTY) console.log(`[${hhmmss()}] ${stripAnsi(text)}`);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function box(title: string, lines: string[], width: number): string[] {
  const top = green("┌─ ") + bold(title) + green(" " + "─".repeat(Math.max(0, width - visLen(title) - 5)) + "┐");
  const body = lines.map((l) => green("│ ") + padEndV(l, width - 4) + green(" │"));
  const bottom = green("└" + "─".repeat(width - 2) + "┘");
  return [top, ...body, bottom];
}

function render(book: PaperBook, executionMode: string, perceptionMode: string): void {
  if (!process.stdout.isTTY) return;
  const width = Math.max(70, Math.min(process.stdout.columns || 110, 120));
  const out: string[] = [];

  // Header
  const spin = scanning ? cyan(SPINNER[spinnerIdx % SPINNER.length]!) : paused ? yellow("∥") : green("●");
  const mode = tradingEnabled ? inverse(green(" TRADING ")) : inverse(yellow(" WATCH-ONLY "));
  const status = paused
    ? yellow("PAUSED")
    : scanning
      ? cyan(`scanning ${scanningSymbol ?? "…"}`)
      : gray(`next scan in ${Math.max(0, Math.ceil((nextScanAt - Date.now()) / 1000))}s`);
  out.push("");
  out.push(
    ` ${spin} ${bold(green("WARDENCLAW"))} ${bold("STOCKS")} ${dim("· xStock earnings/news reactor")}  ${mode}  ` +
      `${dim(`cycle ${cycle}`)}  ${status}`,
  );
  out.push(
    ` ${dim(`perception: ${perceptionMode} · execution: ${executionMode} · candles: ${granularity} · poll: ${pollSeconds}s · ${hhmmss()} UTC`)}`,
  );
  out.push("");

  // Universe scanner table
  const tbl: string[] = [];
  tbl.push(
    dim(
      padEndV("SYMBOL", 8) + padStartV("PRICE", 12) + padStartV("24H", 9) + padStartV("VOL×", 7) +
        padStartV("MOVE", 8) + "  " + padEndV("STATE", 18) + "WHY",
    ),
  );
  for (const sym of TRADEABLE_XSTOCKS) {
    const r = rows.get(sym.display);
    if (!r) {
      tbl.push(padEndV(gray(sym.display), 8) + gray("  awaiting first scan…"));
      continue;
    }
    if (r.error) {
      tbl.push(padEndV(bold(sym.display), 8) + red(` data unavailable: ${r.error.slice(0, width - 40)}`));
      continue;
    }
    tbl.push(
      padEndV(bold(sym.display), 8) +
        padStartV(r.price !== undefined ? fmtUsd(r.price) : "—", 12) +
        padStartV(r.change24hPct !== undefined ? fmtPct(r.change24hPct, 1) : "—", 9) +
        padStartV(r.shock ? `${r.shock.volumeRatio.toFixed(1)}×` : "—", 7) +
        padStartV(r.shock ? fmtPct(r.shock.magnitudePct * 100, 1) : "—", 8) +
        "  " + padEndV(r.state, 18) + dim(r.detail.slice(0, Math.max(10, width - 66))),
    );
  }
  out.push(...box("UNIVERSE SCANNER — real Bitget data, never fabricated", tbl, width - 2));

  // News / sentiment scanner
  const news: string[] = [];
  const gauge = (v: number, w = 20) => {
    const f = Math.round(Math.max(0, Math.min(1, v)) * w);
    const bar = "█".repeat(f) + dim("░".repeat(w - f));
    return v >= 0.5 ? green(bar) : v >= 0.35 ? yellow(bar) : red(bar);
  };
  news.push(`index support  ${gauge(indexSupport)} ${bold(indexSupport.toFixed(2))} ${dim(`(${indexSupportSource})`)}`);
  if (derivBackdrop) {
    const regCol = derivBackdrop.regime === "risk_on" ? green : derivBackdrop.regime === "risk_off" ? red : yellow;
    news.push(
      `derivatives    ${regCol(derivBackdrop.regime.toUpperCase().padEnd(8))} score ${derivBackdrop.score.toFixed(2)} ` +
        dim(`BTC funding ${derivBackdrop.fundingRate} · OI ${derivBackdrop.openInterest}`),
    );
  } else {
    news.push(dim("derivatives    backdrop unavailable (enable BITGET_AGENT_HUB_MCP=true for funding/OI skill)"));
  }
  news.push(dim(newsStatus));
  out.push(...box("NEWS / SENTIMENT SCANNER", news, width - 2));

  // Paper book
  const eq = book.equity(lastPrices);
  const ret = ((eq - 10_000) / 10_000) * 100;
  const bk: string[] = [];
  bk.push(
    `equity ${bold("$" + fmtUsd(eq))} (${fmtPct(ret)})   cash $${fmtUsd(book.cash)}   ` +
      `open ${book.openPositions().length}   closed ${book.closedTrades().length}`,
  );
  for (const p of book.openPositions()) {
    const mark = lastPrices[p.asset] ?? p.entryPrice;
    const upl = (mark - p.entryPrice) * p.quantity;
    bk.push(
      `  ${bold(p.asset.padEnd(7))} qty ${p.quantity.toFixed(4)} @ ${fmtUsd(p.entryPrice)} ` +
        `stop ${fmtUsd(p.stopPrice)} mark ${fmtUsd(mark)} uPnL ${upl >= 0 ? green("$" + fmtUsd(upl)) : red("-$" + fmtUsd(-upl))}`,
    );
  }
  for (const t of book.closedTrades().slice(-3).reverse()) {
    bk.push(
      dim(`  ✓ ${t.asset} ${t.reason} ${fmtUsd(t.entryPrice)}→${fmtUsd(t.exitPrice)} `) +
        (t.pnlUsd >= 0 ? green(`+$${fmtUsd(t.pnlUsd)}`) : red(`-$${fmtUsd(-t.pnlUsd)}`)),
    );
  }
  out.push(...box(`PAPER BOOK — ${executionMode}`, bk, width - 2));

  // Event feed
  const feedHeight = Math.max(4, (process.stdout.rows ?? 40) - out.length - 8);
  const feed = events.slice(-feedHeight).map((e) => `${dim(e.time)} ${e.text}`);
  out.push(...box("EVENT FEED", feed.length ? feed : [dim("waiting for first scan…")], width - 2));

  // Footer
  out.push(
    " " + [
      `${bold("[space]")} ${paused ? "resume" : "pause"}`,
      `${bold("[t]")} trading ${tradingEnabled ? green("on") : yellow("off")}`,
      `${bold("[f]")} scan now`,
      `${bold("[x]")} close all`,
      `${bold("[+/-]")} interval`,
      `${bold("[q]")} quit`,
    ].join(dim("  ·  ")),
  );

  process.stdout.write(`${ESC}H${ESC}2J${ESC}3J` + out.join("\n") + "\n");
}

// ── Scan cycle ────────────────────────────────────────────────────────────────

async function scanOnce(
  md: MarketDataSource,
  agentHub: BitgetMcpAgentHub | undefined,
  agent: BitgetReactorAgent,
  book: PaperBook,
  reactor: ReturnType<typeof reactorConfigFromEnv>,
  mandatesPath: string,
): Promise<void> {
  scanning = true;
  cycle += 1;

  // Index support from the proxies (QQQx/SPYx) — real data only.
  try {
    const proxy = INDEX_PROXIES[0]!;
    scanningSymbol = proxy.display;
    const t = await md.getTicker(proxy.bitgetSymbol);
    const span = t.high24h - t.low24h || 1;
    indexSupport = Math.max(0, Math.min(1, (t.lastPrice - t.low24h) / span));
    indexSupportSource = `${proxy.display} 24h range position`;
  } catch (err) {
    pushEvent(red(`index proxy unavailable: ${(err as Error).message}`));
  }

  if (agentHub) {
    try {
      scanningSymbol = "BTC funding/OI";
      derivBackdrop = await agentHub.getDerivativesSentiment("BTCUSDT");
      const macro = Math.max(0, Math.min(1, (derivBackdrop.score + 1) / 2));
      indexSupport = 0.7 * indexSupport + 0.3 * macro;
      newsStatus = `agent hub sentiment skill: live (funding/OI) · per-equity news feed: none configured`;
    } catch (err) {
      pushEvent(yellow(`risk backdrop unavailable: ${(err as Error).message}`));
    }
  }

  const perceptions: AssetPerception[] = [];
  const now = Date.now();
  for (const sym of TRADEABLE_XSTOCKS) {
    scanningSymbol = sym.display;
    const row: SymbolRow = rows.get(sym.display) ?? {
      display: sym.display,
      bitgetSymbol: sym.bitgetSymbol,
      state: "",
      detail: "",
    };
    try {
      const [ticker, candles] = await Promise.all([
        md.getTicker(sym.bitgetSymbol),
        md.getCandles(sym.bitgetSymbol, granularity, 50),
      ]);
      const st = shockState.get(sym.display) ?? { barsSinceShock: null };
      const shock = detectShock(candles, reactor.shock);
      if (shock.isShock && st.barsSinceShock === null) {
        st.barsSinceShock = 0;
        st.armedShock = shock;
        pushEvent(
          `${yellow("⚡ SHOCK")} ${bold(sym.display)} ${shock.direction} ${(shock.magnitudePct * 100).toFixed(1)}% ` +
            `on ${shock.volumeRatio.toFixed(1)}× volume — armed, first spike rejected`,
        );
      } else if (st.barsSinceShock !== null) {
        st.barsSinceShock += 1;
      }
      shockState.set(sym.display, st);

      const stale = isTickerStale(ticker, now, STALE_MS);
      const perception: AssetPerception = {
        asset: sym.display,
        bars: candles,
        barsSinceShock: st.barsSinceShock,
        armedShock: st.armedShock,
        midPrice: ticker.lastPrice,
        marketDataTimestamp: ticker.timestamp,
        indexSupport,
        feedStale: stale,
      };
      perceptions.push(perception);
      lastPrices[sym.display] = ticker.lastPrice;

      // Display-side evaluation (pure) so the table always shows the reactor's view.
      const decision = evaluateReactor({
        bars: candles,
        barsSinceShock: st.barsSinceShock,
        armedShock: st.armedShock,
        technicalDirection: technicalDirection(candles),
        indexSupport,
        currentExposurePct: 0,
        feedStale: stale,
        cfg: reactor,
      });
      const mid = candles[candles.length - 1]!;
      const past = candles[Math.max(0, candles.length - 1 - 288)]!;
      row.price = ticker.lastPrice;
      row.change24hPct = past.close > 0 ? ((mid.close - past.close) / past.close) * 100 : undefined;
      row.shock = shock;
      row.error = undefined;
      if (st.barsSinceShock === null) {
        row.state = gray("scanning");
      } else if (st.barsSinceShock === 0) {
        row.state = yellow("⚡ shock armed");
      } else if (st.barsSinceShock < reactor.cooldownBars) {
        row.state = yellow(`cooldown ${st.barsSinceShock}/${reactor.cooldownBars}`);
      } else if (decision.action === "enter_long") {
        row.state = green(`▶ ENTER score ${decision.score}`);
      } else {
        row.state = cyan("confirming");
      }
      row.detail = decision.reason[0] ?? "";
    } catch (err) {
      row.error = (err as Error).message;
      pushEvent(red(`${sym.display} skipped (real data unavailable)`));
    }
    rows.set(sym.display, row);
  }
  scanningSymbol = null;

  if (perceptions.length > 0 && tradingEnabled) {
    const result = await agent.runCycle(perceptions);
    for (const mandate of result.mandates) {
      await appendMandate(mandatesPath, mandate);
    }
    for (const exit of result.exits) {
      pushEvent(
        `${bold("EXIT")} ${exit.asset} (${exit.reason}) ${fmtUsd(exit.entryPrice)}→${fmtUsd(exit.exitPrice)} ` +
          (exit.pnlUsd >= 0 ? green(`+$${fmtUsd(exit.pnlUsd)}`) : red(`-$${fmtUsd(-exit.pnlUsd)}`)),
      );
    }
    if (result.executedAsset) {
      pushEvent(green(`◉ ENTERED ${bold(result.executedAsset)} — mandate audited & hash-chained`));
    }
    const rejected = result.mandates.filter((m) => m.execution.status === "rejected").length;
    if (rejected > 0 && cycle % 10 === 1) {
      pushEvent(dim(`${rejected} asset(s) gated this cycle (disciplined skips — see dashboard)`));
    }
  } else if (perceptions.length > 0 && !tradingEnabled) {
    if (cycle % 10 === 1) pushEvent(yellow("watch-only: signals evaluated, execution suppressed ([t] to enable)"));
  }

  scanning = false;
  nextScanAt = Date.now() + pollSeconds * 1000;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
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
  const agentHub = mcpClient ? new BitgetMcpAgentHub(mcpClient) : undefined;

  const auditDir = join(process.cwd(), "data", "audit");
  mkdirSync(auditDir, { recursive: true });
  const runId = `bitget-console-${Date.now()}`;
  const auditPath = join(auditDir, `${runId}.jsonl`);
  const mandatesPath = join(auditDir, `${runId}.mandates.jsonl`);
  const audit = new AuditLogger(auditPath);
  const book = new PaperBook(10_000);
  const reactor = reactorConfigFromEnv();

  const cfg: BitgetAgentConfig = {
    ...DEFAULT_BITGET_AGENT_CONFIG,
    reactor,
    executionMode: "internal_paper_engine",
    compiledStrategy: {},
  };
  const agent = new BitgetReactorAgent(cfg, book, audit, auditPath);

  pushEvent(
    dim(
      `thresholds: shock ≥${(reactor.shock.minMagnitudePct * 100).toFixed(1)}% / ${reactor.shock.windowBars} bars ` +
        `on ≥${reactor.shock.minVolumeRatio}× vol · cooldown ${reactor.cooldownBars} · ` +
        `tp +${((reactor.takeProfitPct ?? 0) * 100).toFixed(1)}% · max hold ${reactor.maxHoldBars} bars`,
    ),
  );
  pushEvent(dim(`audit: ${auditPath}`));

  // Keyboard
  if (process.stdin.isTTY) {
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.on("keypress", (_str: string, key: { name?: string; ctrl?: boolean }) => {
      if (!key) return;
      if (key.name === "q" || (key.ctrl && key.name === "c")) {
        quitting = true;
      } else if (key.name === "space" || key.name === "p") {
        paused = !paused;
        pushEvent(paused ? yellow("scanning paused") : green("scanning resumed"));
      } else if (key.name === "t") {
        tradingEnabled = !tradingEnabled;
        pushEvent(tradingEnabled ? green("trading ENABLED (paper)") : yellow("trading DISABLED — watch-only"));
      } else if (key.name === "f") {
        nextScanAt = Date.now();
        forceScan?.();
        pushEvent(cyan("manual scan requested"));
      } else if (key.name === "x") {
        const open = book.openPositions();
        if (open.length === 0) {
          pushEvent(dim("no open positions to close"));
        }
        for (const p of open) {
          const t = book.close({
            asset: p.asset,
            refPrice: lastPrices[p.asset] ?? p.entryPrice,
            slippageBps: cfg.paperSlippageBps,
            timestamp: new Date().toISOString(),
            reason: "manual",
          });
          pushEvent(
            `${bold("MANUAL EXIT")} ${t.asset} ` +
              (t.pnlUsd >= 0 ? green(`+$${fmtUsd(t.pnlUsd)}`) : red(`-$${fmtUsd(-t.pnlUsd)}`)),
          );
        }
      } else if (_str === "+" || _str === "=") {
        pollSeconds = Math.min(300, pollSeconds + 10);
        pushEvent(dim(`poll interval → ${pollSeconds}s`));
      } else if (_str === "-") {
        pollSeconds = Math.max(10, pollSeconds - 10);
        pushEvent(dim(`poll interval → ${pollSeconds}s`));
      }
    });
  }

  // Render loop (1s tick keeps countdown + spinner alive)
  const renderTimer = setInterval(() => {
    spinnerIdx += 1;
    render(book, cfg.executionMode, md.mode);
  }, scanning ? 120 : 500);

  // Scan loop
  while (!quitting) {
    if (!paused && Date.now() >= nextScanAt) {
      try {
        await scanOnce(md, agentHub, agent, book, reactor, mandatesPath);
      } catch (err) {
        scanning = false;
        nextScanAt = Date.now() + pollSeconds * 1000;
        pushEvent(red(`cycle failed: ${(err as Error).message}`));
      }
    }
    await new Promise<void>((resolve) => {
      forceScan = resolve;
      setTimeout(resolve, 250);
    });
  }

  clearInterval(renderTimer);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdout.write(`${ESC}0m\n`);
  console.log(`[console] audit trail: ${auditPath}`);
  console.log(`[console] mandates:    ${mandatesPath}`);
  await mcpClient?.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error("[console] fatal:", err);
  process.exit(1);
});
