import { describe, it, expect } from "vitest";
import {
  auditStrategy,
  DEFAULT_PLAYBOOK_CONFIG,
  verifyCard,
  type AuditStrategyInput,
} from "../src/index.js";

const KEY = "test-key";
const fixed = { nowIso: "2026-06-19T12:00:00Z", expiresAtIso: "2026-06-19T12:15:00Z", signingKey: KEY };

function audit(strategy: string, extra: Partial<AuditStrategyInput> = {}) {
  return auditStrategy({ strategy, ...fixed, ...extra });
}

// A clean strategy that passes all five static checks.
const CLEAN =
  "Trade NVDAx and AAPLx on confirmed momentum. Never enter the first spike; wait a " +
  "3-bar cooldown after news, then require volume confirmation. Cap daily loss at 4%. " +
  "No leverage above 2x.";

describe("Playbook Shield — verdict aggregation", () => {
  it("Certifies a clean strategy and lets it emit mandates under base caps", () => {
    const r = audit(CLEAN);
    expect(r.verdict).toBe("Certified");
    expect(r.mayEmitMandates).toBe(true);
    expect(r.failedChecks).toEqual([]);
  });
});

describe("check 1 — leverage scanner", () => {
  it("passes leverage within the hard cap", () => {
    expect(audit(CLEAN).checks.find((c) => c.check === "leverage")!.effect).toBe("none");
  });
  it("Restricts (clamps) leverage over the hard cap", () => {
    const r = audit("Long NVDAx with 4x leverage. Daily loss limit 4%. 3-bar cooldown after news with confirmation.");
    expect(r.verdict).toBe("Restricted");
    const lev = r.checks.find((c) => c.check === "leverage")!;
    expect(lev.effect).toBe("restrict");
    expect(lev.value).toBe(4);
  });
  it("Rejects extreme leverage rather than clamping it", () => {
    const r = audit("Long NVDAx with 8x leverage. Daily loss limit 4%. cooldown after news, confirmation required.");
    expect(r.verdict).toBe("Rejected");
    expect(r.checks.find((c) => c.check === "leverage")!.effect).toBe("reject");
  });
});

describe("check 2 — martingale / loss-doubling", () => {
  it("Rejects a loss-doubling strategy outright (never clamped through)", () => {
    const r = audit("Double position size after every loss to recover. Daily loss 4%, cooldown, confirmation.");
    expect(r.verdict).toBe("Rejected");
    expect(r.mayEmitMandates).toBe(false);
    expect(r.failedChecks.find((c) => c.check === "martingale")!.effect).toBe("reject");
  });
  it("passes a strategy with no loss-scaling", () => {
    expect(audit(CLEAN).checks.find((c) => c.check === "martingale")!.passed).toBe(true);
  });
});

describe("check 3 — missing daily-drawdown cap", () => {
  it("Restricts and injects the default cap when none is declared", () => {
    const r = audit("Trade NVDAx on confirmed momentum, 2x. 3-bar cooldown after news, confirmation.");
    const dd = r.checks.find((c) => c.check === "daily_drawdown")!;
    expect(dd.effect).toBe("restrict");
    expect(r.caps.risk.maxDailyDrawdownPct).toBe(DEFAULT_PLAYBOOK_CONFIG.injectedMaxDailyDrawdownPct);
  });
  it("passes when a daily loss limit is present", () => {
    expect(audit(CLEAN).checks.find((c) => c.check === "daily_drawdown")!.passed).toBe(true);
  });
});

describe("check 4 — missing post-shock cooldown", () => {
  it("Restricts and injects a cooldown when none is declared", () => {
    const r = audit("Trade NVDAx on confirmed momentum, 2x. Cap daily loss at 4% with volume confirmation.");
    const cd = r.checks.find((c) => c.check === "cooldown")!;
    expect(cd.effect).toBe("restrict");
    expect(r.caps.cooldownBars).toBe(DEFAULT_PLAYBOOK_CONFIG.injectedCooldownBars);
  });
  it("passes when a cooldown is present", () => {
    expect(audit(CLEAN).checks.find((c) => c.check === "cooldown")!.passed).toBe(true);
  });
});

describe("check 5 — earnings / first-spike exposure", () => {
  it("Restricts and attaches confirmation for earnings entry without it", () => {
    const r = audit("Enter TSLAx around earnings. Cap daily loss 4%. 3-bar cooldown after news.");
    const e = r.checks.find((c) => c.check === "earnings_first_spike")!;
    expect(e.effect).toBe("restrict");
    expect(r.caps.requireConfirmation).toBe(true);
  });
  it("Rejects when it explicitly mandates entering without confirmation", () => {
    const r = audit("Buy NVDAx immediately into earnings and chase the first spike. Daily loss 4%, cooldown after news.");
    expect(r.verdict).toBe("Rejected");
    expect(r.checks.find((c) => c.check === "earnings_first_spike")!.effect).toBe("reject");
  });
  it("passes earnings entry already gated on confirmation", () => {
    expect(audit(CLEAN).checks.find((c) => c.check === "earnings_first_spike")!.passed).toBe(true);
  });
});

describe("conditional check 6 — min closed trades (backtest only)", () => {
  it("does not run without a backtest artifact", () => {
    expect(audit(CLEAN).checks.find((c) => c.check === "min_closed_trades")).toBeUndefined();
  });
  it("Restricts on too few closed trades", () => {
    const r = audit(CLEAN, { backtest: { closedTrades: 5 } });
    expect(r.verdict).toBe("Restricted");
    expect(r.checks.find((c) => c.check === "min_closed_trades")!.effect).toBe("restrict");
  });
  it("passes with enough closed trades", () => {
    const r = audit(CLEAN, { backtest: { closedTrades: 50 } });
    expect(r.verdict).toBe("Certified");
  });
});

describe("Restricted rewrites the caps the compiler will consume", () => {
  it("lowers maxPositionPct/perTradeRiskPct to the conservative restricted book", () => {
    const r = audit("Long NVDAx with 4x leverage. Daily loss limit 4%. 3-bar cooldown after news, confirmation.");
    expect(r.verdict).toBe("Restricted");
    expect(r.caps.risk.maxPositionPct).toBeLessThanOrEqual(DEFAULT_PLAYBOOK_CONFIG.restrictedMaxPositionPct);
    expect(r.caps.risk.perTradeRiskPct).toBeLessThanOrEqual(DEFAULT_PLAYBOOK_CONFIG.restrictedPerTradeRiskPct);
    expect(r.caps.maxLeverage).toBe(DEFAULT_PLAYBOOK_CONFIG.hardMaxLeverage);
  });
});

describe("Strategy Safety Card", () => {
  it("emits a signed, verifiable card carrying the verdict and adjusted caps", () => {
    const r = audit(CLEAN);
    expect(r.card.subject).toBe("strategy_safety");
    expect(r.card.verdict).toBe("Certified");
    expect(verifyCard(r.card, { signingKey: KEY }).ok).toBe(true);
  });
  it("chains from a previous card hash", () => {
    const first = audit(CLEAN);
    const second = audit(CLEAN, { prevCardHash: first.card.json_hash });
    expect(second.card.prev_card_hash).toBe(first.card.json_hash);
    expect(verifyCard(second.card, { signingKey: KEY }).ok).toBe(true);
  });
});
