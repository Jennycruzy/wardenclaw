/**
 * Native evidence logger — every meaningful firewall event to BOTH a
 * human-readable, timestamped, PAPER/SIM-labeled terminal line AND a JSONL file
 * under data/. This is the submission evidence; it is produced natively, with no
 * dependency on any third-party paper-trading studio, and never implies a real fill.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type EvidenceKind =
  | "strategy_verdict"
  | "permit_issued"
  | "gate"
  | "executor"
  | "paper_fill"
  | "close_only"
  | "ghost_sim"
  | "scorecard"
  | "banner";

export interface EvidenceEvent {
  at: string;
  kind: EvidenceKind;
  label: string;
  summary: string;
  data?: Record<string, unknown>;
}

export interface WardenLoggerOptions {
  /** JSONL sink path under data/; omit to log to stdout only. */
  jsonlPath?: string;
  /** Mode tag printed on every line. */
  mode?: "PAPER" | "SIM";
  /** Override the stdout writer (tests). */
  write?: (line: string) => void;
}

export class WardenLogger {
  readonly events: EvidenceEvent[] = [];
  private readonly mode: string;
  private readonly write: (line: string) => void;

  constructor(private readonly opts: WardenLoggerOptions = {}) {
    this.mode = opts.mode ?? "PAPER";
    this.write = opts.write ?? ((l) => process.stdout.write(l + "\n"));
    if (opts.jsonlPath) mkdirSync(dirname(opts.jsonlPath), { recursive: true });
  }

  banner(title: string): void {
    this.write("");
    this.write("=".repeat(60));
    this.write(`  ${title}   [${this.mode} / SIM ONLY]`);
    this.write("=".repeat(60));
    this.record({ kind: "banner", label: "banner", summary: title });
  }

  log(kind: EvidenceKind, label: string, summary: string, data?: Record<string, unknown>): EvidenceEvent {
    const tag = kind.toUpperCase().padEnd(16);
    this.write(`  [${this.mode}] ${tag} ${label.padEnd(22)} ${summary}`);
    return this.record({ kind, label, summary, ...(data ? { data } : {}) });
  }

  private record(partial: Omit<EvidenceEvent, "at"> & { at?: string }): EvidenceEvent {
    const event: EvidenceEvent = { at: partial.at ?? nowIso(), ...partial } as EvidenceEvent;
    this.events.push(event);
    if (this.opts.jsonlPath) appendFileSync(this.opts.jsonlPath, JSON.stringify(event) + "\n", "utf8");
    return event;
  }

  summary(lines: string[]): void {
    this.write("-".repeat(60));
    for (const l of lines) this.write(`  ${l}`);
    this.write("=".repeat(60));
    this.write("");
  }
}

function nowIso(): string {
  return new Date().toISOString();
}
