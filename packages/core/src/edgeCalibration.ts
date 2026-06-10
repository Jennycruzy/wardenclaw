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

/** One observed sample for calibration: a signal score and the move it preceded. */
export interface CalibrationSample {
  score: number;
  /** Realized move over the holding horizon, in bps (signed). */
  realizedMoveBps: number;
  /** Whether the trade direction was correct (a win). */
  win: boolean;
}

/**
 * Build a calibration report from real observed samples. Bands are formed at the
 * given score thresholds; each band aggregates the samples at or above its
 * threshold (and below the next). This consumes real historical data supplied by
 * the calibration script — it never fabricates samples.
 */
export function buildCalibrationReport(
  samples: CalibrationSample[],
  scoreThresholds: number[],
  meta: { version: string; generatedAt: string; historyDays: number },
): CalibrationReport {
  const thresholds = [...scoreThresholds].sort((a, b) => a - b);
  const bands: CalibrationBand[] = thresholds.map((minScore, idx) => {
    const next = thresholds[idx + 1] ?? Infinity;
    const inBand = samples.filter((s) => s.score >= minScore && s.score < next);
    const n = inBand.length;
    const avgMove = n
      ? inBand.reduce((sum, s) => sum + Math.abs(s.realizedMoveBps), 0) / n
      : 0;
    const hitRate = n ? inBand.filter((s) => s.win).length / n : 0;
    // Predicted = the band's own threshold expressed in bps as a naive prior;
    // realizedVsPredicted lets the script see how far the prior was off.
    const predicted = minScore;
    const realizedVsPredicted = predicted > 0 ? avgMove / predicted : 0;
    return {
      minScore,
      realizedMoveBps: Number(avgMove.toFixed(2)),
      hitRate: Number(hitRate.toFixed(4)),
      realizedVsPredicted: Number(realizedVsPredicted.toFixed(4)),
    };
  });

  return {
    version: meta.version,
    generatedAt: meta.generatedAt,
    historyDays: meta.historyDays,
    bands,
  };
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
