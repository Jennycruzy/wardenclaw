/**
 * Server-only data layer for the dashboard. Reads REAL artifacts produced by the
 * engine — mandate JSONL, audit JSONL, and backtest reports — from the monorepo
 * data/ directory. It never invents data: a missing file yields an empty result
 * and the UI renders an explicit empty state with instructions.
 */

import "server-only";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  parseMandate,
  replayMandate,
  type AuditEvent,
  type MandateReplay,
  type SignalMandate,
} from "@wardenclaw/core";
import {
  computePerformance,
  type OpenMark,
  type PaperPerformance,
  type RoundTrip,
} from "@wardenclaw/bitget-adapter";

/** Walk up from cwd to find the monorepo root (where pnpm-workspace.yaml lives). */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const ROOT = findRepoRoot();
const AUDIT_DIR = join(ROOT, "data", "audit");
const BACKTEST_DIR = join(ROOT, "data", "backtests");
const RUNTIME_DIR = join(ROOT, "data", "runtime");
const LIVE_STATE_PATH = join(RUNTIME_DIR, "bitget-live.json");
const COMMAND_QUEUE_PATH = join(RUNTIME_DIR, "bitget-commands.jsonl");

// ---- Live console bridge ----------------------------------------------------
// The interactive console (pnpm console:bitget) publishes its state to
// data/runtime/bitget-live.json and consumes commands appended to
// bitget-commands.jsonl. These helpers are the dashboard's side of the bridge.

/** Verbs the dashboard may queue — mirrors the console's command interpreter. */
export const LIVE_COMMAND_VERBS = [
  "help", "buy", "close", "sell", "news", "scan", "pause", "resume",
  "watch", "trade", "interval", "tp", "mag", "hold", "score", "status",
] as const;

export function loadBitgetLive(): Record<string, unknown> | null {
  if (!existsSync(LIVE_STATE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(LIVE_STATE_PATH, "utf8")) as Record<string, unknown>;
  } catch {
    return null; // torn read between writes; the client polls again shortly
  }
}

export interface LivePaperRecords {
  updatedAt: string;
  navUsd: number;
  cashUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  openPositions: OpenMark[];
  roundTrips: RoundTrip[];
  performance: PaperPerformance | null;
}

/**
 * Build the Records view from the running console's actual paper book snapshot.
 * Missing or malformed runtime state yields null; the UI must show an empty
 * state rather than substitute fixture trades.
 */
export function loadLivePaperRecords(): LivePaperRecords | null {
  const raw = loadBitgetLive();
  if (!raw || typeof raw.updatedAt !== "string" || !raw.book || typeof raw.book !== "object") {
    return null;
  }
  const book = raw.book as Record<string, unknown>;
  if (
    typeof book.equityUsd !== "number" ||
    typeof book.cashUsd !== "number" ||
    !Array.isArray(book.positions) ||
    !Array.isArray(book.closedTrades)
  ) {
    return null;
  }

  const openPositions: OpenMark[] = book.positions.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const p = value as Record<string, unknown>;
    if (
      typeof p.asset !== "string" ||
      typeof p.entryPrice !== "number" ||
      typeof p.markPrice !== "number" ||
      typeof p.quantity !== "number" ||
      typeof p.notionalUsd !== "number" ||
      typeof p.openedAt !== "string"
    ) {
      return [];
    }
    const markValue = p.quantity * p.markPrice;
    const unrealizedUsd = markValue - p.notionalUsd;
    return [{
      asset: p.asset,
      entryPrice: p.entryPrice,
      markPrice: p.markPrice,
      quantity: p.quantity,
      notionalUsd: p.notionalUsd,
      unrealizedUsd,
      unrealizedPct: p.notionalUsd > 0 ? (unrealizedUsd / p.notionalUsd) * 100 : 0,
      openedAt: p.openedAt,
    }];
  });

  const roundTrips: RoundTrip[] = book.closedTrades.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const t = value as Record<string, unknown>;
    if (
      typeof t.asset !== "string" ||
      typeof t.entryPrice !== "number" ||
      typeof t.exitPrice !== "number" ||
      typeof t.notionalUsd !== "number" ||
      typeof t.pnlUsd !== "number" ||
      typeof t.pnlPct !== "number" ||
      typeof t.openedAt !== "string" ||
      typeof t.closedAt !== "string" ||
      !["stop", "signal_exit", "watchdog", "manual"].includes(String(t.reason))
    ) {
      return [];
    }
    return [{
      source: "paper",
      asset: t.asset,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      notionalUsd: t.notionalUsd,
      pnlUsd: t.pnlUsd,
      pnlPct: t.pnlPct,
      openedAt: t.openedAt,
      closedAt: t.closedAt,
      reason: t.reason as RoundTrip["reason"],
    }];
  });

  return {
    updatedAt: raw.updatedAt,
    navUsd: book.equityUsd,
    cashUsd: book.cashUsd,
    realizedPnlUsd: roundTrips.reduce((sum, t) => sum + t.pnlUsd, 0),
    unrealizedPnlUsd: openPositions.reduce((sum, p) => sum + p.unrealizedUsd, 0),
    openPositions,
    roundTrips,
    performance: computePerformance(roundTrips),
  };
}

export function queueBitgetCommand(line: string): { id: number } | { error: string } {
  const cleaned = line.trim().replace(/^[:/]+/, "").slice(0, 120);
  const verb = cleaned.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!(LIVE_COMMAND_VERBS as readonly string[]).includes(verb)) {
    return { error: `unknown command "${verb}" — allowed: ${LIVE_COMMAND_VERBS.join(", ")}` };
  }
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  appendFileSync(COMMAND_QUEUE_PATH, JSON.stringify({ id, line: cleaned, queuedAt: new Date().toISOString() }) + "\n");
  return { id };
}

function listFiles(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .map((f) => join(dir, f));
}

function readJsonl<T>(path: string, parse: (o: unknown) => T): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => parse(JSON.parse(l)));
}

// ---- Mandates -------------------------------------------------------------

export function loadBitgetMandates(): SignalMandate[] {
  const files = listFiles(AUDIT_DIR, ".mandates.jsonl");
  const all: SignalMandate[] = [];
  for (const f of files) {
    for (const m of readJsonl(f, (o) => parseMandate(o))) {
      if (m.venue === "bitget") all.push(m);
    }
  }
  all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return all;
}

export function getBitgetMandate(id: string): SignalMandate | null {
  return loadBitgetMandates().find((m) => m.id === id) ?? null;
}

// ---- Audit events ---------------------------------------------------------

function loadAllAuditEvents(): AuditEvent[] {
  const files = listFiles(AUDIT_DIR, ".jsonl").filter((f) => !f.endsWith(".mandates.jsonl"));
  const events: AuditEvent[] = [];
  for (const f of files) {
    events.push(...readJsonl(f, (o) => o as AuditEvent));
  }
  return events;
}

export function getReplay(mandateId: string): MandateReplay | null {
  const events = loadAllAuditEvents();
  const mine = events.filter((e) => e.mandateId === mandateId);
  if (mine.length === 0) return null;
  // Replay over the file's own ordered events so the integrity check is meaningful.
  return replayMandate(mandateId, events);
}

export function getMandateAuditEvents(mandateId: string): AuditEvent[] {
  return loadAllAuditEvents().filter((e) => e.mandateId === mandateId);
}

// ---- Derived paper stats --------------------------------------------------

export interface PaperStats {
  total: number;
  filled: number;
  rejected: number;
  watching: number;
  byRejectCode: Array<{ code: string; count: number }>;
  byAsset: Array<{ asset: string; total: number; filled: number }>;
  executionModes: Array<{ mode: string; count: number }>;
  lastUpdated: string | null;
}

export function computePaperStats(mandates: SignalMandate[]): PaperStats {
  const rejectCounts = new Map<string, number>();
  const assetMap = new Map<string, { total: number; filled: number }>();
  const modeMap = new Map<string, number>();
  let filled = 0;
  let rejected = 0;
  let watching = 0;

  for (const m of mandates) {
    if (m.execution.status === "filled") filled++;
    else if (m.execution.status === "rejected") rejected++;
    else watching++;

    for (const r of m.decision.rejectedReasons ?? []) {
      rejectCounts.set(r, (rejectCounts.get(r) ?? 0) + 1);
    }
    const a = assetMap.get(m.asset) ?? { total: 0, filled: 0 };
    a.total++;
    if (m.execution.status === "filled") a.filled++;
    assetMap.set(m.asset, a);

    modeMap.set(m.execution.adapter, (modeMap.get(m.execution.adapter) ?? 0) + 1);
  }

  return {
    total: mandates.length,
    filled,
    rejected,
    watching,
    byRejectCode: [...rejectCounts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count),
    byAsset: [...assetMap.entries()]
      .map(([asset, v]) => ({ asset, ...v }))
      .sort((a, b) => b.total - a.total),
    executionModes: [...modeMap.entries()].map(([mode, count]) => ({ mode, count })),
    lastUpdated: mandates[0]?.createdAt ?? null,
  };
}

// ---- Backtests ------------------------------------------------------------

export interface BacktestReport {
  fileName: string;
  source: string;
  generatedAt: string;
  bars: number;
  summary: {
    numTrades: number;
    pnlUsd: number;
    totalReturnPct: number;
    maxDrawdownPct: number;
    winRate: number;
  };
  rejections: Record<string, number>;
  trades: Array<{
    entryTime: string;
    exitTime: string;
    entryPrice: number;
    exitPrice: number;
    notionalUsd: number;
    frictionBps: number;
    pnlUsd: number;
    reason: string;
  }>;
  equityCurve?: Array<{ time: string; equityUsd: number }>;
}

export function listBacktests(): BacktestReport[] {
  const files = listFiles(BACKTEST_DIR, ".json");
  const reports: BacktestReport[] = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(f, "utf8")) as BacktestReport;
      reports.push({ ...raw, fileName: f.split("/").pop() ?? f });
    } catch {
      // Skip unreadable/old-format reports rather than crash the page.
    }
  }
  reports.sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1));
  return reports;
}

/** Headline report for the backtest page: strictly the newest generated report. */
export function getLatestBacktest(): BacktestReport | null {
  return listBacktests()[0] ?? null;
}

// ---- Environment / mode readouts -----------------------------------------

export interface DashboardEnv {
  llmEnabled: boolean;
  llmProvider: string;
  agentHubConfigured: boolean;
  /** Resolved Bitget execution mode (mirrors the run script's selection). */
  bitgetExecutionMode: "official_bitget_demo" | "internal_paper_engine";
  /** Demo Trading credential vars still missing (empty = complete). */
  bitgetDemoMissing: string[];
}

export function readDashboardEnv(): DashboardEnv {
  const provider = process.env.LLM_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "disabled");
  const demoMissing = ["BITGET_API_KEY", "BITGET_API_SECRET", "BITGET_API_PASSPHRASE"].filter(
    (v) => !process.env[v],
  );
  const wantsDemo = process.env.BITGET_EXECUTION_MODE === "official_bitget_demo";
  return {
    llmEnabled: process.env.LLM_ENABLED !== "false" && provider !== "disabled",
    llmProvider: provider,
    agentHubConfigured:
      process.env.BITGET_AGENT_HUB_MCP === "true" ||
      Boolean(process.env.BITGET_AGENT_HUB_BASE_URL),
    bitgetExecutionMode:
      wantsDemo && demoMissing.length === 0 ? "official_bitget_demo" : "internal_paper_engine",
    bitgetDemoMissing: demoMissing,
  };
}

/** Load the aggregate scorecard (generated by `pnpm run:scorecard`); null if absent. */
export function loadScorecard(): { summary: Record<string, unknown> } | null {
  const p = join(ROOT, "output", "scorecard.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as { summary: Record<string, unknown> };
  } catch {
    return null;
  }
}

/** Load cached real Bitget candles for a universe display symbol (e.g. "NVDAx"). */
export function loadFixtureCandles(
  symbol: string,
): Array<{ time: string; open: number; high: number; low: number; close: number }> {
  const p = join(ROOT, "fixtures", "market", "scorecard-candles.json");
  if (!existsSync(p)) return [];
  try {
    const d = JSON.parse(readFileSync(p, "utf8")) as {
      series: Record<string, { candles: Array<{ time: string; open: number; high: number; low: number; close: number }> }>;
    };
    return d.series?.[symbol]?.candles ?? [];
  } catch {
    return [];
  }
}
