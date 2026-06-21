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

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseEnv } from "dotenv";
import { emitKeypressEvents } from "node:readline";
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
  TRADEABLE_XSTOCKS,
  INDEX_PROXIES,
  detectShock,
  evaluateReactor,
  technicalDirection,
  reactorConfigFromEnv,
  isTickerStale,
  YahooFinanceNewsFeed,
  CachedNewsScanner,
  compileBitgetStrategy,
  atrPct,
  type ScannedNews,
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
/** Clip to n visible chars, passing ANSI codes through and re-resetting at the end. */
function clipV(s: string, n: number): string {
  if (visLen(s) <= n) return s;
  let out = "";
  let vis = 0;
  for (let i = 0; i < s.length && vis < n - 1; i++) {
    if (s[i] === "\u001b") {
      const m = s.slice(i).match(/^\u001b\[[0-9;]*m/);
      if (m) {
        out += m[0];
        i += m[0].length - 1;
        continue;
      }
    }
    out += s[i];
    vis += 1;
  }
  return out + reset + dim("\u2026");
}

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

/**
 * Live kill-switch shared with the headless paper agent. Re-reads .env each
 * cycle so flipping REACTOR_PAUSED suppresses mandate generation without
 * restarting the console. Accepts 1/true/yes/on (case-insensitive).
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
const newsByAsset = new Map<string, ScannedNews>();
const seenHeadlines = new Set<string>();
const lastBars = new Map<string, BitgetCandle[]>();
// Command bar (`:` to open): typed command → deterministic action.
let cmdMode = false;
let cmdBuf = "";
let runCommand: (line: string) => Promise<void> = async () => {};

// Web-dashboard bridge: the console publishes its live state to a JSON file
// the Next.js dashboard reads, and consumes commands the dashboard queues.
const RUNTIME_DIR = join(process.cwd(), "data", "runtime");
const LIVE_STATE_PATH = join(RUNTIME_DIR, "bitget-live.json");
const COMMAND_QUEUE_PATH = join(RUNTIME_DIR, "bitget-commands.jsonl");
let lastCommandId = 0;
let publishLiveState: () => void = () => {};

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
  const body = lines.map((l) => green("│ ") + padEndV(clipV(l, width - 4), width - 4) + green(" │"));
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
  for (const sym of TRADEABLE_XSTOCKS) {
    const n = newsByAsset.get(sym.display);
    if (!n) continue;
    const latest = n.items[0];
    const dirBadge = !n.event
      ? gray("·unclassified")
      : n.event.direction === "positive"
        ? green(`▲${n.event.direction} ${(n.event.confidence * 100).toFixed(0)}%`)
        : n.event.direction === "negative"
          ? red(`▼${n.event.direction} ${(n.event.confidence * 100).toFixed(0)}%`)
          : yellow(`◆${n.event.direction}`);
    const ageMin = latest ? Math.max(0, Math.round((Date.now() - Date.parse(latest.publishedAt)) / 60_000)) : 0;
    news.push(
      padEndV(bold(sym.display), 7) +
        padEndV(dirBadge, 16) +
        (latest
          ? dim(`"${latest.headline.slice(0, Math.max(20, width - 50))}" · ${ageMin}m ago`)
          : dim("no headlines in window")),
    );
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

  // Footer: command bar when open, shortcut help otherwise.
  if (cmdMode) {
    out.push(" " + inverse(green(` : ${cmdBuf}▌ `)));
    out.push(
      " " +
        dim(
          "commands: buy <SYM> [usd] · close <SYM>|all · news [SYM] · scan · pause · resume · " +
            "watch · trade · interval <s> · tp <pct> · mag <pct> · hold <bars> · score <n> · help  (esc cancels)",
        ),
    );
  } else {
    out.push(
      " " + [
        `${bold("[:]")} command`,
        `${bold("[space]")} ${paused ? "resume" : "pause"}`,
        `${bold("[t]")} trading ${tradingEnabled ? green("on") : yellow("off")}`,
        `${bold("[f]")} scan now`,
        `${bold("[x]")} close all`,
        `${bold("[+/-]")} interval`,
        `${bold("[q]")} quit`,
      ].join(dim("  ·  ")),
    );
  }

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
  scanner: CachedNewsScanner | null,
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
      lastBars.set(sym.display, candles);

      // REAL per-equity news for the underlying US stock, classified by the
      // configured LLM into the reactor's sentiment gate (absent when no LLM).
      if (scanner) {
        try {
          scanningSymbol = `${sym.underlying} news`;
          const scanned = await scanner.scan(sym.underlying, sym.display);
          newsByAsset.set(sym.display, scanned);
          for (const item of scanned.items.slice(0, 2)) {
            if (seenHeadlines.has(item.id)) continue;
            seenHeadlines.add(item.id);
            pushEvent(`${cyan("📰")} ${bold(sym.display)} ${dim(`"${item.headline.slice(0, 90)}"`)}`);
          }
          if (scanned.event && scanned.event.direction !== "unknown") {
            const d = scanned.event.direction;
            const col = d === "positive" ? green : d === "negative" ? red : yellow;
            if (scanned.summary && !seenHeadlines.has(`sum:${sym.display}:${scanned.fetchedAt}`)) {
              seenHeadlines.add(`sum:${sym.display}:${scanned.fetchedAt}`);
              pushEvent(
                `${col("◆ sentiment")} ${bold(sym.display)} ${col(d)} ` +
                  `${(scanned.event.confidence * 100).toFixed(0)}% — ${dim(scanned.summary.slice(0, 80))}`,
              );
            }
          }
          if (scanner.lastError) pushEvent(yellow(`news classifier degraded: ${scanner.lastError.slice(0, 70)}`));
        } catch (err) {
          pushEvent(yellow(`${sym.display} news unavailable: ${(err as Error).message.slice(0, 60)}`));
        }
      }

      const stale = isTickerStale(ticker, now, STALE_MS);
      const perception: AssetPerception = {
        asset: sym.display,
        bars: candles,
        barsSinceShock: st.barsSinceShock,
        armedShock: st.armedShock,
        midPrice: ticker.lastPrice,
        marketDataTimestamp: ticker.timestamp,
        event: newsByAsset.get(sym.display)?.event,
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
        event: newsByAsset.get(sym.display)?.event,
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

  if (perceptions.length > 0 && tradingEnabled && !reactorPaused()) {
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
  } else if (perceptions.length > 0 && reactorPaused()) {
    if (cycle % 10 === 1)
      pushEvent(yellow("REACTOR_PAUSED=true — scanning live, mandate generation suppressed (set false in .env to resume)"));
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
    const client = new BitgetMcpClient({
      modules: "spot,futures",
      readOnly: true,
    });
    try {
      await client.start();
      mcpClient = client;
      md = new BitgetMcpMarketData(client);
    } catch (err) {
      pushEvent(
        yellow(
          `Agent Hub MCP unavailable (${(err as Error).message.slice(0, 100)}); using live Bitget public REST`,
        ),
      );
      try {
        await client.stop();
      } catch {
        // best-effort cleanup of the failed child process
      }
      mcpClient = undefined;
      md = new BitgetPublicMarketData({ baseUrl: process.env.BITGET_PUBLIC_BASE_URL });
    }
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

  // StrategyCompilerAgent: NL intent → deterministic strategy JSON (LLM proposes
  // when configured, clamped to hard caps; deterministic manual fallback else).
  const compilerLlm = createLlmProvider(
    process.env,
    process.env.STRATEGY_COMPILER_MODEL || undefined,
  );
  const compiled = await compileBitgetStrategy({
    naturalLanguageIntent: DEFAULT_BITGET_AGENT_CONFIG.naturalLanguageIntent,
    reactor,
    provider: compilerLlm,
  });
  pushEvent(
    dim(
      `strategy compiled (${compiled.source}): ${compiled.strategy.universe.join("/")}` +
        (compiled.clamped.length > 0 ? ` · clamped: ${compiled.clamped.join(", ")}` : "") +
        (compiled.fallbackReason ? ` · llm fallback: ${compiled.fallbackReason.slice(0, 90)}` : ""),
    ),
  );

  const cfg: BitgetAgentConfig = {
    ...DEFAULT_BITGET_AGENT_CONFIG,
    reactor,
    executionMode: "internal_paper_engine",
    perTradeRiskPct: compiled.strategy.riskLimits.perTradeRiskPct,
    stopAtrMultiple: compiled.strategy.riskLimits.stopAtrMultiple,
    netEdgeMinBps: compiled.strategy.riskLimits.netEdgeMinBps,
    compiledStrategy: compiled.strategy,
  };
  const agent = new BitgetReactorAgent(cfg, book, audit, auditPath);

  // Real per-equity news (Yahoo Finance RSS for the underlying) + the existing
  // LLM layer as classifier. Disable with BITGET_NEWS_FEED=false.
  let scanner: CachedNewsScanner | null = null;
  if (process.env.BITGET_NEWS_FEED !== "false") {
    const llm = createLlmProvider(process.env, process.env.NEWS_SENTIMENT_MODEL || undefined);
    const deterministicFallback = process.env.BITGET_NEWS_DETERMINISTIC_FALLBACK !== "false";
    scanner = new CachedNewsScanner(new YahooFinanceNewsFeed(), llm, {
      ttlSeconds: Number(process.env.BITGET_NEWS_TTL_SECONDS ?? "300"),
      deterministicFallback,
    });
    newsStatus = `news: yahoo finance RSS (real headlines) · classifier: ${
      scanner.classifierEnabled ? llm.name : "LLM disabled"
    }${deterministicFallback ? " · deterministic lexicon fallback ON" : " · events absent"}`;
  }

  pushEvent(
    dim(
      `thresholds: shock ≥${(reactor.shock.minMagnitudePct * 100).toFixed(1)}% / ${reactor.shock.windowBars} bars ` +
        `on ≥${reactor.shock.minVolumeRatio}× vol · cooldown ${reactor.cooldownBars} · ` +
        `tp +${((reactor.takeProfitPct ?? 0) * 100).toFixed(1)}% · max hold ${reactor.maxHoldBars} bars`,
    ),
  );
  pushEvent(dim(`audit: ${auditPath}`));

  // Command interpreter: deterministic parsing, real execution, full audit.
  runCommand = async (line: string): Promise<void> => {
    // Accept ":buy", "/buy", and "buy" alike (terminal bar and web box).
    const [verb, ...args] = line.trim().replace(/^[:/]+/, "").split(/\s+/);
    if (!verb) return;
    const v = verb.toLowerCase();
    const symArg = (s?: string) =>
      s ? TRADEABLE_XSTOCKS.find((x) => x.display.toLowerCase() === s.toLowerCase() || x.underlying.toLowerCase() === s.toLowerCase()) : undefined;
    try {
      if (v === "help") {
        pushEvent(dim("buy <SYM> [usd] · close <SYM>|all · news [SYM] · scan · pause · resume · watch · trade · interval <s> · tp <pct> · mag <pct> · hold <bars> · score <n> · status"));
      } else if (v === "buy") {
        const sym = symArg(args[0]);
        if (!sym) return pushEvent(red(`unknown symbol: ${args[0] ?? "(none)"} — try ${TRADEABLE_XSTOCKS.map((s) => s.display).join("/")}`));
        const price = lastPrices[sym.display];
        const bars = lastBars.get(sym.display);
        if (!price || !bars) return pushEvent(red(`no market data for ${sym.display} yet — wait for a scan`));
        if (book.getPosition(sym.display)) return pushEvent(yellow(`${sym.display} position already open`));
        const equity = book.equity(lastPrices);
        const want = args[1] ? Number(args[1]) : 0.1 * equity;
        if (!Number.isFinite(want) || want <= 0) return pushEvent(red(`bad notional: ${args[1]}`));
        const notional = Math.min(want, reactor.maxSingleStockPct * equity, book.cash);
        const stopDistancePct = Math.max(cfg.stopAtrMultiple * atrPct(bars), 0.005);
        const ts = new Date().toISOString();
        const fill = book.open({
          asset: sym.display,
          refPrice: price,
          notionalUsd: notional,
          stopPrice: price * (1 - stopDistancePct),
          slippageBps: cfg.paperSlippageBps,
          timestamp: ts,
          mandateId: `manual-${sym.display}-${ts}`,
        });
        await audit.append({
          timestamp: ts,
          mandateId: `manual-${sym.display}-${ts}`,
          stage: "execution",
          input: { command: line, source: "interactive_console" },
          output: { status: "filled", fillPrice: fill.fillPrice, notionalUsd: fill.notionalUsd, simulated: true },
          proofAnchors: { paperFillSource: `${cfg.executionMode}@${ts}` },
        });
        pushEvent(green(`◉ MANUAL BUY ${bold(sym.display)} $${fmtUsd(notional)} @ ${fmtUsd(fill.fillPrice)} (stop ${(stopDistancePct * 100).toFixed(1)}% below)`));
      } else if (v === "close" || v === "sell") {
        const all = (args[0] ?? "all").toLowerCase() === "all";
        const targets = all ? book.openPositions() : [book.getPosition(symArg(args[0])?.display ?? "")].filter(Boolean);
        if (targets.length === 0) return pushEvent(dim("nothing to close"));
        for (const p of targets) {
          const t = book.close({
            asset: p!.asset,
            refPrice: lastPrices[p!.asset] ?? p!.entryPrice,
            slippageBps: cfg.paperSlippageBps,
            timestamp: new Date().toISOString(),
            reason: "manual",
          });
          pushEvent(`${bold("MANUAL EXIT")} ${t.asset} ` + (t.pnlUsd >= 0 ? green(`+$${fmtUsd(t.pnlUsd)}`) : red(`-$${fmtUsd(-t.pnlUsd)}`)));
        }
      } else if (v === "news") {
        if (!scanner) return pushEvent(yellow("news feed disabled (BITGET_NEWS_FEED=false)"));
        const targets = symArg(args[0]) ? [symArg(args[0])!] : TRADEABLE_XSTOCKS;
        for (const sym of targets) {
          const scanned = await scanner.scan(sym.underlying, sym.display, true);
          newsByAsset.set(sym.display, scanned);
          pushEvent(`${cyan("📰")} ${bold(sym.display)} ${scanned.items.length} headlines` +
            (scanned.event ? ` → ${scanned.event.direction} ${(scanned.event.confidence * 100).toFixed(0)}%` : " (unclassified)"));
        }
      } else if (v === "scan") {
        nextScanAt = Date.now();
        forceScan?.();
      } else if (v === "pause") {
        paused = true;
        pushEvent(yellow("scanning paused"));
      } else if (v === "resume") {
        paused = false;
        pushEvent(green("scanning resumed"));
      } else if (v === "watch") {
        tradingEnabled = false;
        pushEvent(yellow("watch-only mode"));
      } else if (v === "trade") {
        tradingEnabled = true;
        pushEvent(green("trading ENABLED (paper)"));
      } else if (v === "interval") {
        const n = Number(args[0]);
        if (!Number.isFinite(n) || n < 10) return pushEvent(red("usage: interval <seconds ≥10>"));
        pollSeconds = Math.min(600, Math.round(n));
        pushEvent(dim(`poll interval → ${pollSeconds}s`));
      } else if (v === "tp" || v === "mag") {
        const n = Number(args[0]);
        if (!Number.isFinite(n) || n <= 0 || n > 20) return pushEvent(red(`usage: ${v} <percent, e.g. 1.5>`));
        if (v === "tp") reactor.takeProfitPct = n / 100;
        else reactor.shock.minMagnitudePct = n / 100;
        pushEvent(green(`${v === "tp" ? "take-profit" : "shock magnitude"} → ${n}%`));
      } else if (v === "hold") {
        const n = Number(args[0]);
        if (!Number.isFinite(n) || n < 1) return pushEvent(red("usage: hold <bars>"));
        reactor.maxHoldBars = Math.round(n);
        pushEvent(green(`max hold → ${reactor.maxHoldBars} bars`));
      } else if (v === "score") {
        const n = Number(args[0]);
        if (!Number.isFinite(n) || n < 0 || n > 100) return pushEvent(red("usage: score <0-100>"));
        reactor.minEntryScore = Math.round(n);
        pushEvent(green(`entry score threshold → ${reactor.minEntryScore}`));
      } else if (v === "status") {
        pushEvent(dim(
          `shock ≥${(reactor.shock.minMagnitudePct * 100).toFixed(1)}% · vol ≥${reactor.shock.minVolumeRatio}× · ` +
            `cooldown ${reactor.cooldownBars} · score ≥${reactor.minEntryScore} · tp +${((reactor.takeProfitPct ?? 0) * 100).toFixed(1)}% · ` +
            `hold ${reactor.maxHoldBars} bars · poll ${pollSeconds}s · ${tradingEnabled ? "trading" : "watch-only"}`,
        ));
      } else {
        pushEvent(red(`unknown command: ${verb} — type 'help'`));
      }
    } catch (err) {
      pushEvent(red(`command failed: ${(err as Error).message}`));
    }
    publishLiveState();
  };

  // Publish the console's full live state for the web dashboard. Written
  // atomically so the reader never sees a torn file.
  mkdirSync(RUNTIME_DIR, { recursive: true });
  publishLiveState = () => {
    try {
      const state = {
        running: true,
        updatedAt: new Date().toISOString(),
        cycle,
        paused,
        tradingEnabled,
        pollSeconds,
        scanning,
        scanningSymbol,
        perception: md.mode,
        executionMode: cfg.executionMode,
        thresholds: {
          shockMinMagnitudePct: reactor.shock.minMagnitudePct,
          shockMinVolumeRatio: reactor.shock.minVolumeRatio,
          shockWindowBars: reactor.shock.windowBars,
          cooldownBars: reactor.cooldownBars,
          minEntryScore: reactor.minEntryScore,
          takeProfitPct: reactor.takeProfitPct ?? null,
          maxHoldBars: reactor.maxHoldBars ?? null,
        },
        indexSupport,
        indexSupportSource,
        derivatives: derivBackdrop
          ? {
              regime: derivBackdrop.regime,
              score: derivBackdrop.score,
              fundingRate: derivBackdrop.fundingRate,
              openInterest: derivBackdrop.openInterest,
            }
          : null,
        newsStatus: stripAnsi(newsStatus),
        symbols: TRADEABLE_XSTOCKS.map((s) => {
          const r = rows.get(s.display);
          const n = newsByAsset.get(s.display);
          return {
            symbol: s.display,
            bitgetSymbol: s.bitgetSymbol,
            price: r?.price ?? null,
            change24hPct: r?.change24hPct ?? null,
            volumeRatio: r?.shock?.volumeRatio ?? null,
            movePct: r?.shock ? r.shock.magnitudePct * 100 : null,
            state: r ? stripAnsi(r.state) : "awaiting first scan",
            detail: r ? stripAnsi(r.detail) : "",
            error: r?.error ?? null,
            news: n
              ? {
                  fetchedAt: n.fetchedAt,
                  event: n.event ?? null,
                  summary: n.summary ?? null,
                  headlines: n.items.slice(0, 3).map((i) => ({
                    headline: i.headline,
                    url: i.url ?? null,
                    publishedAt: i.publishedAt,
                  })),
                }
              : null,
          };
        }),
        book: {
          equityUsd: book.equity(lastPrices),
          cashUsd: book.cash,
          positions: book.openPositions().map((p) => ({
            asset: p.asset,
            entryPrice: p.entryPrice,
            quantity: p.quantity,
            notionalUsd: p.notionalUsd,
            stopPrice: p.stopPrice,
            markPrice: lastPrices[p.asset] ?? p.entryPrice,
            openedAt: p.openedAt,
          })),
          closedTrades: book.closedTrades().slice(-10).reverse(),
        },
        events: events.slice(-30).map((e) => ({ time: e.time, text: stripAnsi(e.text) })),
        lastCommandId,
      };
      const tmp = `${LIVE_STATE_PATH}.tmp`;
      writeFileSync(tmp, JSON.stringify(state));
      renameSync(tmp, LIVE_STATE_PATH);
    } catch {
      // Publishing is best-effort; the terminal console must never die over it.
    }
  };

  // Consume commands queued by the web dashboard. On startup, skip anything
  // already in the file — stale commands must not replay into a fresh book.
  const readQueuedCommands = (): Array<{ id: number; line: string }> => {
    if (!existsSync(COMMAND_QUEUE_PATH)) return [];
    return readFileSync(COMMAND_QUEUE_PATH, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as { id: number; line: string };
        } catch {
          return null;
        }
      })
      .filter((c): c is { id: number; line: string } => Boolean(c && typeof c.id === "number" && typeof c.line === "string"));
  };
  lastCommandId = readQueuedCommands().reduce((m, c) => Math.max(m, c.id), 0);
  let pollingCommands = false;
  const pollWebCommands = async (): Promise<void> => {
    if (pollingCommands) return;
    pollingCommands = true;
    try {
      for (const c of readQueuedCommands()) {
        if (c.id <= lastCommandId) continue;
        lastCommandId = c.id;
        pushEvent(cyan(`▸ web command: ${c.line.slice(0, 60)}`));
        await runCommand(c.line.slice(0, 120));
      }
    } finally {
      pollingCommands = false;
    }
  };

  // Keyboard
  if (process.stdin.isTTY) {
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.on("keypress", (_str: string, key: { name?: string; ctrl?: boolean; sequence?: string }) => {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        quitting = true;
        return;
      }
      // Command-bar input mode captures all keys until enter/escape.
      if (cmdMode) {
        if (key.name === "return" || key.name === "enter") {
          const line = cmdBuf;
          cmdMode = false;
          cmdBuf = "";
          if (line.trim()) void runCommand(line);
        } else if (key.name === "escape") {
          cmdMode = false;
          cmdBuf = "";
        } else if (key.name === "backspace") {
          cmdBuf = cmdBuf.slice(0, -1);
        } else if (_str && _str >= " " && _str.length === 1) {
          cmdBuf += _str;
        }
        return;
      }
      if (_str === ":") {
        cmdMode = true;
        cmdBuf = "";
        return;
      }
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
  let lastPublishAt = 0;
  while (!quitting) {
    if (!paused && Date.now() >= nextScanAt) {
      try {
        await scanOnce(md, agentHub, agent, book, reactor, mandatesPath, scanner);
      } catch (err) {
        scanning = false;
        nextScanAt = Date.now() + pollSeconds * 1000;
        pushEvent(red(`cycle failed: ${(err as Error).message}`));
      }
      publishLiveState();
    }
    await pollWebCommands();
    if (Date.now() - lastPublishAt > 3000) {
      lastPublishAt = Date.now();
      publishLiveState();
    }
    await new Promise<void>((resolve) => {
      forceScan = resolve;
      setTimeout(resolve, 250);
    });
  }

  clearInterval(renderTimer);
  try {
    writeFileSync(LIVE_STATE_PATH, JSON.stringify({ running: false, updatedAt: new Date().toISOString() }));
  } catch {
    // best-effort
  }
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
