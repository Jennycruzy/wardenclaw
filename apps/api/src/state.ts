/**
 * File-backed runtime state shared between the API and the worker (they are
 * separate processes under the process manager). The API writes the kill flag and
 * reads the heartbeat; the worker writes the heartbeat and reads the kill flag.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const RUNTIME_DIR = join(repoRoot(), "data", "runtime");
const KILL_FLAG = join(RUNTIME_DIR, "kill.flag.json");
const HEARTBEAT = join(RUNTIME_DIR, "heartbeat.json");

function ensureDir(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
}

export interface KillFlag {
  engaged: boolean;
  engagedAtIso: string;
  by: string;
}

export function writeKillFlag(by: string): KillFlag {
  ensureDir();
  const flag: KillFlag = { engaged: true, engagedAtIso: new Date().toISOString(), by };
  writeFileSync(KILL_FLAG, JSON.stringify(flag), "utf8");
  return flag;
}

export function readKillFlag(): KillFlag | null {
  if (!existsSync(KILL_FLAG)) return null;
  try {
    return JSON.parse(readFileSync(KILL_FLAG, "utf8")) as KillFlag;
  } catch {
    return null;
  }
}

export interface HeartbeatState {
  lastBeatIso: string;
  mode: string;
  cyclesRun: number;
}

export function writeHeartbeat(state: HeartbeatState): void {
  ensureDir();
  writeFileSync(HEARTBEAT, JSON.stringify(state), "utf8");
}

export function readHeartbeat(): HeartbeatState | null {
  if (!existsSync(HEARTBEAT)) return null;
  try {
    return JSON.parse(readFileSync(HEARTBEAT, "utf8")) as HeartbeatState;
  } catch {
    return null;
  }
}
