# Playbook Shield — pre-flight strategy auditor

Playbook Shield is **checkpoint 1** of the WardenClaw command firewall. A strategy
must pass it **before** the system will let it generate any Signal Mandates:

```
strategy → [Playbook Shield] → (Restricted caps) → StrategyCompilerAgent → Signal Mandates → Trade-Permit Engine
```

> "No unsafe strategy even produces mandates."

It is a thin pre-flight pass that **reuses the trade-verdict semantics and feeds the
existing strategy-compiler clamp** — not a parallel risk engine. Every verdict is
deterministic; the LLM never participates.

## Three strategy verdicts

| Verdict | Mirrors | Effect |
|---|---|---|
| **Certified** | APPROVE | safe as written; emits mandates under base caps |
| **Restricted** | REDUCE | emits mandates, but only under tightened caps — **those caps ARE the clamp config handed to the compiler**, so the downstream pipeline really runs under the lowered numbers |
| **Rejected** | BLOCK | no mandates are generated, period |

Aggregation: any **reject** check ⇒ Rejected; else any **restrict** check ⇒
Restricted; else Certified.

## Five deterministic static checks

Parsed from the strategy text — no statistics required.

| # | Check | Trigger | Effect |
|---|---|---|---|
| 1 | **Leverage scanner** | leverage `> hardMaxLeverage` (3×) | Restrict (clamp). `≥ extremeLeverage` (5×) ⇒ Reject |
| 2 | **Martingale / loss-doubling** | "increase/double size after a loss", "average down", martingale | **Reject** — the headline danger, never clamped through |
| 3 | **Missing daily-drawdown cap** | no daily loss limit declared | Restrict — inject the default cap |
| 4 | **Missing post-shock cooldown** | no cooldown / first-spike rule | Restrict — inject cooldown bars |
| 5 | **Earnings / first-spike exposure** | enters earnings windows or chases first spikes without confirmation | Restrict (attach confirmation); **Reject** if it explicitly mandates entry without confirmation ("immediately", "chase", "without confirmation") |

**Conditional check 6 — min closed trades:** runs **only** when a backtest artifact is
supplied. Too few closed trades ⇒ Restrict (overfit risk). The Shield does **not**
attempt Sharpe / "one lucky stock" detection from text alone — that would be narrated
vibes and is forbidden.

## Warden-adjusted caps (what Restricted rewrites)

A Restricted verdict produces a tightened `RiskConfig` plus firewall fields:

- `maxPositionPct`, `perTradeRiskPct` → clamped to the conservative **restricted book**
  (35% / 1.5% by default) — the compiler clamps the compiled strategy to these.
- `maxDailyDrawdownPct` → injected when the strategy declared none.
- `cooldownBars` → injected when the strategy declared none.
- `requireConfirmation` → set when earnings/first-spike entry lacked confirmation.
- `maxLeverage` → the hard ceiling enforced later by the Trade-Permit Engine.

## Strategy Safety Card

Every audit emits one signed, hash-chained **Strategy Safety Card** — the same artifact
type as the Trade Permit, different `subject` (`strategy_safety`). It carries the
verdict, the failed checks as `{check, value, threshold}`, the Warden-adjusted caps, the
strategy hash, `may_emit_mandates`, and the `prev_card_hash` / `json_hash` / `signature`
envelope (HMAC-SHA256, canonical serialization). See `packages/core/src/wardenCard.ts`.

## Code

- `packages/core/src/playbookShield.ts` — `auditStrategy()`, the checks, the verdict, the card.
- `packages/core/src/wardenCard.ts` — shared signing / hashing / chain core.
- `packages/bitget-adapter/src/playbook.ts` — `auditAndCompileBitgetStrategy()`: the
  enforcement seam. Rejected ⇒ no compilation (no mandates); Restricted ⇒ the compiler
  runs under the tightened caps; Certified ⇒ base caps.
- Tests: `packages/core/test/playbookShield.test.ts`,
  `packages/core/test/wardenCard.test.ts`,
  `packages/bitget-adapter/test/playbook.test.ts`.
