/**
 * Hourly portfolio snapshots. The competition measures returns hour by hour and
 * zeroes any hour that begins with the portfolio worth at or below the floor.
 * This mirrors that scoring so the agent can verify the organizers' numbers, and
 * computes the whole-window drawdown used by the governor.
 */

export interface Holding {
  symbol: string;
  amount: number;
  priceUsd: number;
}

/** Value a set of holdings in USD. */
export function valueHoldings(holdings: Holding[]): number {
  return holdings.reduce((sum, h) => sum + h.amount * h.priceUsd, 0);
}

export interface HourlySnapshot {
  hourIso: string;
  valueUsd: number;
}

export interface HourlyReturn {
  hourIso: string;
  startValueUsd: number;
  endValueUsd: number;
  /** Percent return for the hour, or 0 if the hour started at/below the floor. */
  returnPct: number;
  zeroedByFloor: boolean;
}

/**
 * Build the per-hour return series. A snapshot is the value at the START of an
 * hour; the return for hour i uses snapshot[i] -> snapshot[i+1]. An hour that
 * begins at/below the floor scores 0% regardless of its end value.
 */
export function buildHourlyReturns(
  snapshots: HourlySnapshot[],
  floorUsd: number,
): HourlyReturn[] {
  const returns: HourlyReturn[] = [];
  for (let i = 0; i < snapshots.length - 1; i++) {
    const start = snapshots[i]!;
    const end = snapshots[i + 1]!;
    const zeroedByFloor = start.valueUsd <= floorUsd;
    const returnPct =
      zeroedByFloor || start.valueUsd === 0
        ? 0
        : ((end.valueUsd - start.valueUsd) / start.valueUsd) * 100;
    returns.push({
      hourIso: start.hourIso,
      startValueUsd: start.valueUsd,
      endValueUsd: end.valueUsd,
      returnPct,
      zeroedByFloor,
    });
  }
  return returns;
}

/** Peak-to-trough drawdown across the snapshot series, in percent. */
export function maxDrawdownPct(snapshots: HourlySnapshot[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  for (const s of snapshots) {
    if (s.valueUsd > peak) peak = s.valueUsd;
    if (peak > 0) {
      const dd = ((peak - s.valueUsd) / peak) * 100;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return maxDd;
}

/** Total return from first to last snapshot, in percent. */
export function totalReturnPct(snapshots: HourlySnapshot[]): number {
  if (snapshots.length < 2) return 0;
  const first = snapshots[0]!.valueUsd;
  const last = snapshots[snapshots.length - 1]!.valueUsd;
  if (first === 0) return 0;
  return ((last - first) / first) * 100;
}
