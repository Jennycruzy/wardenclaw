/**
 * Append-only JSONL store for full SignalMandates.
 *
 * The audit logger records per-stage events for integrity/replay; this stores
 * the complete validated mandate objects so dashboards can render them directly.
 * Both files live side by side under data/audit/. Reads validate every line
 * through the schema, so a malformed record surfaces loudly rather than rendering
 * as a half-broken row.
 */

import { appendFile, readFile } from "node:fs/promises";
import { parseMandate } from "./signalMandate.js";
import type { SignalMandate } from "./types.js";

export async function appendMandate(filePath: string, mandate: SignalMandate): Promise<void> {
  // Validate before persisting — never store a malformed mandate.
  const valid = parseMandate(mandate);
  await appendFile(filePath, JSON.stringify(valid) + "\n", "utf8");
}

export async function readMandates(filePath: string): Promise<SignalMandate[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => parseMandate(JSON.parse(line)));
}
