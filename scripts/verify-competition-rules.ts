/**
 * Verifies the competition-rules registry: every verified rule must have an
 * implementation reference, and the open items are surfaced as hard warnings.
 * Exits non-zero only when a verified rule is missing an implementation.
 */

import { verifyCompetitionRules } from "@runeclaw/core";

function main(): void {
  const result = verifyCompetitionRules();

  console.log(`\nVerified rules (${result.verified.length}):`);
  for (const r of result.verified) {
    console.log(`  ✓ ${r.rule}`);
    console.log(`      impl: ${r.implementationFile}${r.exactValue ? `  value: ${r.exactValue}` : ""}`);
  }

  console.log(`\nOpen items needing organizer confirmation (${result.warnings.length}):`);
  for (const r of result.warnings) {
    console.log(`  ⚠ ${r.rule}`);
    console.log(`      default: ${r.exactValue ?? "(none)"}  [${r.status}]`);
  }

  if (result.missingImplementation.length > 0) {
    console.error(`\n✗ ${result.missingImplementation.length} verified rule(s) lack an implementation reference:`);
    for (const r of result.missingImplementation) console.error(`  - ${r.rule}`);
    process.exit(1);
  }

  console.log(
    `\n✓ Competition rules verified. ${result.warnings.length} open item(s) carry conservative defaults (authoritative until an organizer confirms).`,
  );
}

main();
