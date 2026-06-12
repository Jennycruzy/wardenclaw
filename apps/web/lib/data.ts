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

/**
 * Headline report for the backtest page: the most recent report that actually
 * traded. A calibrated selective threshold legitimately produces 0-trade
 * reports for quiet symbols; showing one as the headline reads as "empty" when
 * the discipline is the story. Falls back to the most recent report overall.
 */
export function getLatestBacktest(): BacktestReport | null {
  const all = listBacktests();
  return all.find((r) => r.summary.numTrades > 0) ?? all[0] ?? null;
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
