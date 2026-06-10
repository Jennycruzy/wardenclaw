/**
 * Return-vs-Drawdown Governor.
 *
 * Budgets risk against whichever drawdown layer binds first: the competition
 * disqualifier, the internal whole-window budget, and the internal daily limit.
 * Presses size when realized edge is real and budget is healthy; shrinks size
 * toward zero as the binding budget thins. Never exceeds configured caps and
 * never overrides the net-edge gate.
 */

export interface DrawdownState {
  /** Whole-window peak-to-trough drawdown so far, in percent. */
  windowDrawdownPct: number;
  /** Today's drawdown so far, in percent. */
  dailyDrawdownPct: number;
}

export interface GovernorInputs {
  state: DrawdownState;
  /** Caps in percent. */
  competitionDqDrawdownPct: number;
  internalWindowDrawdownPct: number;
  maxDailyDrawdownPct: number;
  /** Fractional Kelly multiplier. */
  kellyFraction: number;
  /** Edge estimate in [0,1] derived from the calibrated score. */
  edgeEstimate: number;
  /** Hard cap on position fraction from other gates (e.g. maxPositionPct/100). */
  maxPositionFraction: number;
}

export interface GovernorResult {
  /** Allowed position size as a fraction of deployable capital, in [0, maxPositionFraction]. */
  sizeFraction: number;
  /** Which layer is currently binding. */
  bindingLayer: "competition" | "window" | "daily";
  remainingBudgetPct: number;
  reason: string;
}

/** Remaining headroom against a cap, never negative. */
function remaining(capPct: number, usedPct: number): number {
  return Math.max(0, capPct - usedPct);
}

export function evaluateGovernor(inputs: GovernorInputs): GovernorResult {
  const { state } = inputs;

  const layers = [
    {
      name: "competition" as const,
      remaining: remaining(inputs.competitionDqDrawdownPct, state.windowDrawdownPct),
      cap: inputs.competitionDqDrawdownPct,
    },
    {
      name: "window" as const,
      remaining: remaining(inputs.internalWindowDrawdownPct, state.windowDrawdownPct),
      cap: inputs.internalWindowDrawdownPct,
    },
    {
      name: "daily" as const,
      remaining: remaining(inputs.maxDailyDrawdownPct, state.dailyDrawdownPct),
      cap: inputs.maxDailyDrawdownPct,
    },
  ];

  // The binding layer is the one with the least remaining headroom.
  const binding = layers.reduce((a, b) => (b.remaining < a.remaining ? b : a));

  const edge = Math.max(0, Math.min(1, inputs.edgeEstimate));
  const baseFraction = inputs.kellyFraction * edge;

  // Linearly scale the allowed size by how much of the binding budget remains.
  const budgetRatio = binding.cap > 0 ? binding.remaining / binding.cap : 0;
  const drawdownScaledCap = inputs.maxPositionFraction * budgetRatio;

  const sizeFraction = Math.max(
    0,
    Math.min(baseFraction, drawdownScaledCap, inputs.maxPositionFraction),
  );

  return {
    sizeFraction,
    bindingLayer: binding.name,
    remainingBudgetPct: binding.remaining,
    reason: `binding ${binding.name} layer, ${binding.remaining.toFixed(1)}% of ${binding.cap}% budget left → size fraction ${(sizeFraction * 100).toFixed(1)}%`,
  };
}
