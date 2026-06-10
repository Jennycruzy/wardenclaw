/**
 * Builds the score -> expected-move calibration report from REAL observed
 * samples. It reads samples from data/calibration/samples.json — each an observed
 * (score, realizedMoveBps, win) tuple produced by replaying historical CMC data
 * through the signal families. It never invents samples; if the file is missing it
 * fails loudly with instructions, because shipping an uncalibrated edge mapping is
 * a loss condition.
 */

import "dotenv/config";

import { readFile, writeFile } from "node:fs/promises";
import { buildCalibrationReport, type CalibrationSample } from "@runeclaw/core";

const SAMPLES_PATH = process.env.CALIBRATION_SAMPLES_PATH ?? "data/calibration/samples.json";
const REPORT_PATH = process.env.CALIBRATION_REPORT_PATH ?? "data/calibration/report.json";
const SCORE_THRESHOLDS = [65, 75, 80, 90];

async function main(): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(SAMPLES_PATH, "utf8");
  } catch {
    console.error(`✗ No calibration samples at ${SAMPLES_PATH}.`);
    console.error("  Generate them by replaying ~30 days of CMC data through both signal");
    console.error("  families over the eligible universe, then write an array of");
    console.error('  { "score": number, "realizedMoveBps": number, "win": boolean }.');
    console.error("  This script will not fabricate market data.");
    process.exit(1);
    return;
  }

  const samples = JSON.parse(raw) as CalibrationSample[];
  if (!Array.isArray(samples) || samples.length === 0) {
    console.error("✗ Calibration samples file is empty or malformed.");
    process.exit(1);
    return;
  }

  const generatedAt = process.env.CALIBRATION_TIMESTAMP ?? new Date().toISOString();
  const report = buildCalibrationReport(samples, SCORE_THRESHOLDS, {
    version: `cal-${generatedAt.slice(0, 10)}`,
    generatedAt,
    historyDays: Number(process.env.CALIBRATION_HISTORY_DAYS ?? 30),
  });

  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`✓ Calibration report written to ${REPORT_PATH} (version ${report.version})`);
  console.log("\n  Score band → realized move (bps) | hit rate | realized/predicted");
  for (const b of report.bands) {
    console.log(
      `  >=${b.minScore}: ${b.realizedMoveBps.toString().padStart(7)} bps | ${(b.hitRate * 100).toFixed(1)}% | ${b.realizedVsPredicted}`,
    );
  }
  console.log("\n  Tune NET_EDGE_MIN_BPS so bands whose realized move is below friction do not trade.");
}

main().catch((err) => {
  console.error("✗ calibrate-edge failed:", err);
  process.exit(1);
});
