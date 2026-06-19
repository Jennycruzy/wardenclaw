/**
 * Close-Only Watcher — the background position monitor that can flip the account
 * into CLOSE-ONLY survival mode. CLOSE-ONLY cannot emerge from per-command
 * evaluation alone: it is an account-level state set by watching OPEN (paper)
 * positions over time and tripped by a threshold breach. While active, every
 * exposure-increasing permit is refused at issuance AND at the executor; only
 * risk-reducing actions (reduce / close / cancel) are allowed. State transitions
 * are emitted as signed Warden Cards so an auditor can see exactly when and why
 * survival mode engaged or cleared.
 *
 * It reuses the deterministic gate math (liquidation distance) and the BTC-vol /
 * funding signals — no new risk discretion.
 */

import { liquidationDistancePct } from "./tradePermit.js";
import { sealCard, type SignedCard } from "./wardenCard.js";

export interface OpenPositionState {
  asset: string;
  btcCorrelated: boolean;
  leverage: number;
  /** Current price and the entry price, for the liquidation-distance computation. */
  entryPrice: number;
  currentPrice: number;
}

export interface AccountSignals {
  /** BTC realized vol rising (macro-analyst) — dangerous for correlated holdings. */
  btcRealizedVolRising: boolean;
  /** Funding rate deteriorating against open longs. */
  fundingDeteriorating: boolean;
}

export interface CloseOnlyConfig {
  /** Liquidation distance below this (%) on any open position → flip. */
  minLiquidationDistancePct: number;
  maintenanceMarginRate: number;
}

export const DEFAULT_CLOSE_ONLY_CONFIG: CloseOnlyConfig = {
  minLiquidationDistancePct: 8,
  maintenanceMarginRate: 0.005,
};

export interface CloseOnlyAssessment {
  active: boolean;
  triggers: string[];
  reasons: string[];
}

/** Pure assessment: should the account be CLOSE-ONLY given current positions + signals? */
export function assessCloseOnly(
  positions: OpenPositionState[],
  signals: AccountSignals,
  cfg: CloseOnlyConfig = DEFAULT_CLOSE_ONLY_CONFIG,
): CloseOnlyAssessment {
  const triggers: string[] = [];
  const reasons: string[] = [];

  for (const p of positions) {
    const dist = liquidationDistancePct(p.leverage, cfg.maintenanceMarginRate);
    if (dist < cfg.minLiquidationDistancePct) {
      triggers.push("liquidation_distance");
      reasons.push(`${p.asset}: liquidation distance ${dist.toFixed(1)}% < ${cfg.minLiquidationDistancePct}%`);
    }
    if (p.btcCorrelated && signals.btcRealizedVolRising) {
      triggers.push("btc_vol_spike");
      reasons.push(`${p.asset}: BTC-correlated holding while BTC realized vol is rising`);
    }
  }
  if (signals.fundingDeteriorating && positions.length > 0) {
    triggers.push("funding_deterioration");
    reasons.push("funding rate deteriorating against open longs");
  }

  return { active: triggers.length > 0, triggers, reasons: reasons.length ? reasons : ["no survival triggers"] };
}

export interface CloseOnlyStateCardBody {
  subject: "close_only_state";
  transition: "entered" | "cleared";
  active: boolean;
  triggers: string[];
  reasons: string[];
  at: string;
}
export type CloseOnlyStateCard = SignedCard<CloseOnlyStateCardBody>;

/**
 * Stateful controller. Call `update` each poll; it returns a signed state card on
 * a transition (entered/cleared) and null when the state is unchanged.
 */
export class CloseOnlyController {
  private active = false;
  private lastCardHash: string | undefined;

  constructor(
    private readonly cfg: CloseOnlyConfig = DEFAULT_CLOSE_ONLY_CONFIG,
    private readonly signingKey?: string,
  ) {}

  get isActive(): boolean {
    return this.active;
  }

  update(
    positions: OpenPositionState[],
    signals: AccountSignals,
    nowIso: string,
  ): { assessment: CloseOnlyAssessment; card: CloseOnlyStateCard | null } {
    const assessment = assessCloseOnly(positions, signals, this.cfg);
    if (assessment.active === this.active) {
      return { assessment, card: null };
    }
    this.active = assessment.active;
    const body: CloseOnlyStateCardBody = {
      subject: "close_only_state",
      transition: assessment.active ? "entered" : "cleared",
      active: assessment.active,
      triggers: assessment.triggers,
      reasons: assessment.reasons,
      at: nowIso,
    };
    const card = sealCard(body, {
      ...(this.lastCardHash ? { prevCardHash: this.lastCardHash } : {}),
      ...(this.signingKey ? { signingKey: this.signingKey } : {}),
    });
    this.lastCardHash = card.json_hash;
    return { assessment, card };
  }
}
