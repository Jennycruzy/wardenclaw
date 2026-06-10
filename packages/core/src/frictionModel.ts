/**
 * Micro-capital friction model.
 *
 * On a ~$40 spot book friction dominates PnL, and the competition also charges a
 * simulated transaction cost against scored return — so every trade pays twice.
 * This computes round-trip friction in basis points of notional.
 */

export interface FrictionInputs {
  notionalUsd: number;
  /** Live gas estimate for the entry leg in USD (BSC gas units × gas price × BNB price). */
  gasInUsd: number;
  /** Live gas estimate for the exit leg in USD. */
  gasOutUsd: number;
  /** Expected slippage from the actual router quote vs mid, in bps (one leg). */
  expectedSlippageBps: number;
  /** PancakeSwap pool fee for the pair, in bps (one leg). */
  lpFeeBps: number;
  /** Competition's simulated cost per leg (conservative default until confirmed). */
  scoringSimCostBps: number;
  /** Configurable safety margin in bps. */
  safetyBufferBps?: number;
}

export interface FrictionResult {
  /** Total round-trip friction in bps, INCLUDING the simulated scoring cost. */
  frictionBps: number;
  /** Round-trip friction excluding the simulated scoring cost (real-world cost). */
  realFrictionBps: number;
  /** The simulated scoring cost contribution (round trip = 2 legs). */
  simulatedCostBps: number;
  breakdown: {
    gasBps: number;
    slippageBps: number; // round trip
    lpFeeBps: number; // round trip
    safetyBufferBps: number;
  };
}

/**
 * Compute round-trip friction. Slippage and LP fee are charged on both legs;
 * the simulated scoring cost is charged per leg (×2). Gas is the sum of both
 * legs' USD cost expressed as bps of notional.
 */
export function computeFriction(inputs: FrictionInputs): FrictionResult {
  if (inputs.notionalUsd <= 0) {
    throw new Error("computeFriction: notionalUsd must be > 0");
  }
  const safetyBufferBps = inputs.safetyBufferBps ?? 0;

  const gasBps = ((inputs.gasInUsd + inputs.gasOutUsd) / inputs.notionalUsd) * 10_000;
  const slippageBps = inputs.expectedSlippageBps * 2;
  const lpFeeBps = inputs.lpFeeBps * 2;
  const simulatedCostBps = inputs.scoringSimCostBps * 2;

  const realFrictionBps = gasBps + slippageBps + lpFeeBps + safetyBufferBps;
  const frictionBps = realFrictionBps + simulatedCostBps;

  return {
    frictionBps,
    realFrictionBps,
    simulatedCostBps,
    breakdown: { gasBps, slippageBps, lpFeeBps, safetyBufferBps },
  };
}
