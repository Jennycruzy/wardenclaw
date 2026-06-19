import { describe, it, expect } from "vitest";
import { DisabledProvider } from "@wardenclaw/core";
import {
  auditAndCompileBitgetStrategy,
  DEFAULT_REACTOR_CONFIG,
} from "../src/index.js";

const fixed = {
  reactor: DEFAULT_REACTOR_CONFIG,
  provider: new DisabledProvider(),
  signingKey: "test-key",
  nowIso: "2026-06-19T12:00:00Z",
  expiresAtIso: "2026-06-19T12:15:00Z",
};

const CLEAN =
  "Trade NVDAx and AAPLx on confirmed momentum. Never enter the first spike; wait a " +
  "3-bar cooldown after news, then require volume confirmation. Cap daily loss at 4%. " +
  "No leverage above 2x.";

describe("Playbook Shield → compiler wiring", () => {
  it("Certified: compiles and emits mandates under the base caps", async () => {
    const r = await auditAndCompileBitgetStrategy({ ...fixed, strategy: CLEAN });
    expect(r.verdict).toBe("Certified");
    expect(r.compiled).toBe(true);
    expect(r.strategy).toBeDefined();
  });

  it("Rejected: blocks mandate generation entirely (no compiled strategy)", async () => {
    const r = await auditAndCompileBitgetStrategy({
      ...fixed,
      strategy: "Double position size after every loss to recover. Daily loss 4%, cooldown, confirmation.",
    });
    expect(r.verdict).toBe("Rejected");
    expect(r.compiled).toBe(false);
    expect(r.strategy).toBeUndefined();
  });

  it("Restricted: the compiler actually runs under the tightened numbers", async () => {
    const r = await auditAndCompileBitgetStrategy({
      ...fixed,
      strategy: "Long NVDAx with 4x leverage. Daily loss limit 4%. 3-bar cooldown after news, confirmation.",
    });
    expect(r.verdict).toBe("Restricted");
    expect(r.compiled).toBe(true);
    // The base bitget cap is 50% (maxSingleStockPct 0.5); Restricted clamps it to 35.
    expect(r.compiledUnder!.maxPositionPct).toBeLessThanOrEqual(35);
    expect(r.strategy!.strategy.riskLimits.maxPositionPct).toBeLessThanOrEqual(35);
  });
});
