/**
 * Ranks shock candidates across the xStock universe so the agent acts on the
 * strongest, confirmed setup rather than the noisiest one. Ranking is by a
 * deterministic blend of confirmed score and shock magnitude; only candidates
 * the reactor approved (action === "enter_long") are rankable.
 */

import type { ReactorDecision } from "./reactor.js";

export interface RankedCandidate {
  asset: string;
  score: number;
  expectedMoveBps: number;
  decision: ReactorDecision;
  rankScore: number;
}

export interface ShockCandidate {
  asset: string;
  decision: ReactorDecision;
}

/**
 * Rank approved entries. Candidates whose decision is not an entry are excluded
 * (but the caller still audits their reject reasons separately).
 */
export function rankShocks(candidates: ShockCandidate[]): RankedCandidate[] {
  const ranked: RankedCandidate[] = [];
  for (const c of candidates) {
    if (c.decision.action !== "enter_long") continue;
    const score = c.decision.score ?? 0;
    const expectedMoveBps = c.decision.expectedMoveBps ?? 0;
    // Blend: score dominates, expected move breaks ties.
    const rankScore = score * 100 + expectedMoveBps;
    ranked.push({ asset: c.asset, score, expectedMoveBps, decision: c.decision, rankScore });
  }
  ranked.sort((a, b) => b.rankScore - a.rankScore);
  return ranked;
}

/** The single best confirmed candidate, or null when none qualified. */
export function topShock(candidates: ShockCandidate[]): RankedCandidate | null {
  return rankShocks(candidates)[0] ?? null;
}
