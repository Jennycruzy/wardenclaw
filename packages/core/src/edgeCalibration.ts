/**
 * Score → expected-move calibration.
 *
 * The mapping from a deterministic trade score to expected_move_bps is the single
 * number deciding whether the agent ever trades, so it must come from a
 * calibration run on real historical data, not a guess. This module holds the
 * data structures and the deterministic, versioned mapping function; the actual
 * historical replay lives in the calibration script.
 */

export interface CalibrationBand {
  /** Inclusive lower bound of the score band (0–100). */
  minScore: number;
  /** Average realized move (bps) observed for signals in this band. */
  realizedMoveBps: number;
  /** Hit rate observed for this band, in [0,1]. */
  hitRate: number;
  /** realized / predicted ratio observed during calibration. */
  realizedVsPredicted: number;
}

export interface CalibrationReport {
  version: string;
  /** ISO timestamp the calibration was produced. */
  generatedAt: string;
  /** Number of trading days of history replayed. */
  historyDays: number;
  /** Bands sorted ascending by minScore. */
  bands: CalibrationBand[];
}

/**
 * Map a score to expected_move_bps using the calibration bands. The expected
 * move for a score is the realized move of the highest band whose minScore the
 * score meets. Scores below the lowest band map to 0 (no edge).
 */
export function expectedMoveBps(score: number, report: CalibrationReport): number {
  const sorted = [...report.bands].sort((a, b) => a.minScore - b.minScore);
  let move = 0;
  for (const band of sorted) {
    if (score >= band.minScore) move = band.realizedMoveBps;
  }
  return move;
}

/** Edge estimate in [0,1] for the governor: hit rate of the matched band. */
export function edgeEstimate(score: number, report: CalibrationReport): number {
  const sorted = [...report.bands].sort((a, b) => a.minScore - b.minScore);
  let edge = 0;
  for (const band of sorted) {
    if (score >= band.minScore) edge = band.hitRate;
  }
  return Math.max(0, Math.min(1, edge));
}

/** A calibration is stale when older than the configured max age. */
export function isCalibrationStale(
  report: CalibrationReport,
  nowMs: number,
  maxAgeDays: number,
): boolean {
  const generatedMs = Date.parse(report.generatedAt);
  if (!Number.isFinite(generatedMs)) return true;
  const ageDays = (nowMs - generatedMs) / (1000 * 60 * 60 * 24);
  return ageDays > maxAgeDays;
}
