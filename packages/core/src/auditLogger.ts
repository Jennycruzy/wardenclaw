/**
 * Append-only JSONL audit logger with hash chaining.
 *
 * Hash chaining proves log integrity (no event was altered or removed), not
 * real-world truth — external proof anchors carry that. Each event's hash covers
 * its content plus the previous event's hash, so any tampering breaks the chain.
 */

import { createHash } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";

export type AuditStage =
  | "perception"
  | "decision"
  | "economics"
  | "risk"
  | "execution"
  | "watchdog"
  | "settlement"
  | "recovery"
  | "snapshot";

export interface AuditEventInput {
  timestamp: string;
  mandateId: string;
  stage: AuditStage;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  proofAnchors?: Record<string, unknown>;
}

export interface AuditEvent extends AuditEventInput {
  previousHash: string;
  eventHash: string;
}

const GENESIS_HASH = "0".repeat(64);

/** Deterministic hash over the event content plus the previous hash. */
export function hashEvent(input: AuditEventInput, previousHash: string): string {
  const canonical = JSON.stringify({
    timestamp: input.timestamp,
    mandateId: input.mandateId,
    stage: input.stage,
    input: input.input,
    output: input.output,
    proofAnchors: input.proofAnchors ?? {},
    previousHash,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Build a chained event from an input and the prior hash (pure, testable). */
export function buildEvent(input: AuditEventInput, previousHash: string): AuditEvent {
  return {
    ...input,
    previousHash,
    eventHash: hashEvent(input, previousHash),
  };
}

/** Verify a full chain of events. Returns the index of the first break, or -1. */
export function verifyChain(events: AuditEvent[]): number {
  let prev = GENESIS_HASH;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.previousHash !== prev) return i;
    const expected = hashEvent(e, e.previousHash);
    if (expected !== e.eventHash) return i;
    prev = e.eventHash;
  }
  return -1;
}

/**
 * Filesystem-backed audit logger. Keeps the last hash in memory and appends one
 * JSON line per event. The genesis previous-hash is all zeros.
 */
export class AuditLogger {
  private lastHash: string;

  constructor(
    private readonly filePath: string,
    lastHash: string = GENESIS_HASH,
  ) {
    this.lastHash = lastHash;
  }

  get currentHash(): string {
    return this.lastHash;
  }

  /** Append an event, chaining from the last hash. Returns the written event. */
  async append(input: AuditEventInput): Promise<AuditEvent> {
    const event = buildEvent(input, this.lastHash);
    await appendFile(this.filePath, JSON.stringify(event) + "\n", "utf8");
    this.lastHash = event.eventHash;
    return event;
  }

  /** Read and parse all events from the backing file. */
  async readAll(): Promise<AuditEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch {
      return [];
    }
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as AuditEvent);
  }
}

export { GENESIS_HASH };
