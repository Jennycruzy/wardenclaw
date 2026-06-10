/**
 * Replay a single mandate from its hash-chained audit events — what the agent
 * saw, decided, why it traded or skipped (with reject codes), the integrity
 * check, and external proof anchors.
 *
 *   pnpm replay --mandate <id>
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { replayMandate, type AuditEvent } from "@runeclaw/core";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const id = arg("--mandate") ?? process.argv[2];
  if (!id) {
    console.error("usage: pnpm replay --mandate <id>");
    process.exit(1);
  }

  const auditDir = join(process.cwd(), "data", "audit");
  if (!existsSync(auditDir)) {
    console.error("no data/audit directory — run an agent first");
    process.exit(1);
  }

  const events: AuditEvent[] = [];
  for (const f of readdirSync(auditDir)) {
    if (!f.endsWith(".jsonl") || f.endsWith(".mandates.jsonl") || f.endsWith(".snapshots.jsonl")) continue;
    const raw = readFileSync(join(auditDir, f), "utf8");
    for (const line of raw.split("\n")) {
      if (line.trim()) events.push(JSON.parse(line) as AuditEvent);
    }
  }

  const mine = events.filter((e) => e.mandateId === id);
  if (mine.length === 0) {
    console.error(`no audit events found for mandate ${id}`);
    process.exit(1);
  }

  const replay = replayMandate(id, events);
  console.log(`\n  Replay: ${id}`);
  console.log(`  Integrity: ${replay.integrityOk ? "hash chain intact" : `BROKEN at #${replay.integrityBreakIndex}`}`);
  console.log(`  Stages: ${replay.stages.map((s) => s.stage).join(" → ")}`);
  if (replay.decision) console.log(`  Decision: ${JSON.stringify(replay.decision)}`);
  if (replay.economics) console.log(`  Economics: ${JSON.stringify(replay.economics)}`);
  if (replay.rejections.length) {
    console.log(`  Rejections:`);
    for (const r of replay.rejections) console.log(`    [${r.stage}] ${JSON.stringify(r.output)}`);
  }
  console.log(`  Integrity proof: ${replay.proof.integrityProof}`);
  console.log(`  Truth anchors: ${replay.proof.truthAnchors.join(", ") || "none"}`);
  console.log(`  Paper-only: ${replay.proof.paperOnly}\n`);
}

main();
