# WARDENCLAW — Command Firewall for Bitget xStocks

A **two-checkpoint command firewall** for Bitget tokenized US stocks (xStocks). It
audits the **strategy** before it may run, then audits **each trade command** before
execution, and proves — cryptographically — why it acted.

> **No valid Warden Permit = no execution.**
> And one step earlier: **no unsafe strategy even produces mandates.**

This submission uses **Bitget-native data and tools only**: the official **Agent Hub**,
**Skill Hub** perception skills, and **two MCP servers** (Bitget's own + WardenClaw's).
No CMC, no Trust Wallet, no BNB SDK, no BSC. Paper trading is the only simulation allowance
in the whole system, and it is **real paper trading on real Bitget prices** — fills are
simulated against **real Bitget market data**, always labeled `internal_paper_engine` /
`simulated: true`, never static mock data, and never presented as a real exchange fill.

## The two checkpoints

```
Bitget Playbook / human / AI strategy
        │
        ▼
[1] PLAYBOOK SHIELD ── audits the STRATEGY            Certified / Restricted / Rejected
        │   (Restricted hands tightened caps to the compiler clamp)
        ▼
Risk-bound Signal Mandates  (only a passing strategy emits them, under its clamped caps)
        │
        ▼
[2] TRADE-PERMIT ENGINE ── audits each TRADE command  APPROVE / REDUCE / DELAY / HEDGE / BLOCK / CLOSE-ONLY
        │
        ▼
Sim Executor (paper only) ── independently verifies the signed permit; no valid permit = no execution
        │
        ▼
Signed, hash-chained, replayable Warden Card  +  native terminal evidence
```

**Checkpoint 1 — Playbook Shield** audits the strategy before it can run, returning
**Certified / Restricted / Rejected** over five deterministic static checks (leverage,
martingale, missing daily-drawdown cap, missing post-shock cooldown, earnings/first-spike
without confirmation). *Restricted* hands tightened caps to the strategy compiler clamp;
*Rejected* emits no mandates. See `docs/PLAYBOOK_SHIELD.md`.

**Checkpoint 2 — Trade-Permit Engine** audits each trade command, returning **APPROVE /
REDUCE / DELAY / HEDGE / BLOCK / CLOSE-ONLY** over ten deterministic gates — including the
asset-class-native **xStock premium/discount** gate and the **BTC-correlation HEDGE** gate.
The LLM only parses the command into a structured intent; **every verdict is deterministic
and fail-closed**. See `docs/GATE_TABLE.md`.

**Warden Permit** — every non-BLOCK verdict produces a **signed (HMAC-SHA256), single-use,
expiring, price-drift-bound, hash-chained** permit. The sim executor verifies it
independently before any (paper) order: no valid permit, no execution.

## What is real vs. paper

| Layer | Status |
|---|---|
| Market data | **Real** — two interchangeable sources: the official **Bitget Agent Hub MCP server** (`bitget-mcp-server`, spawned over stdio; tool surface verified via `tools/list`) and the Bitget public v2 REST API. Both fail loudly if a symbol returns nothing. |
| xStock symbols | **Verified** against the live Bitget symbols API: equities trade under the `<TICKER>ON` convention (e.g. `NVDAONUSDT`); the BTC-correlated names resolve to `RMSTRUSDT` / `RCOINUSDT`. |
| Per-equity news | **Real** — Yahoo Finance public RSS for each underlying US stock; the configured LLM classifies real headlines only (strict structured output). No LLM, no key → events are honestly absent, deterministic gates run alone. |
| Derivatives / macro backdrop | **Real** — BTC funding rate + open interest and BTC realized volatility from the Agent Hub MCP futures tools, mapped deterministically to a risk regime and the BTC-correlation gate. |
| Strategy compilation | **Real** — the NL strategy compiles to deterministic JSON at startup (LLM proposes when configured; every risk number is clamped to the hard caps and to any Playbook-Shield restriction; a deterministic manual strategy is the fallback). |
| Playbook Shield / gates / verdicts | **Real**, deterministic, fully tested. The LLM cannot bypass them. |
| Warden Permit (signing / chain / lifecycle) | **Real** — HMAC-SHA256, single-use, expiring, price-drift-bound, hash-chained; verified independently by the executor. |
| Counterfactuals / scorecard | **Real** — ghost-sims and the 60-command scorecard are computed from **real Bitget candles**; re-running yields identical numbers. |
| Execution | **Paper** — internal paper engine, every fill labeled `internal_paper_engine` / `simulated: true`. |
| Official Bitget Demo Trading | **Implemented but unusable for spot xStocks** — verified that Bitget Demo Trading is **futures-only** (`paptrading` spot endpoints return "exchange environment is incorrect"). The executor exists (`demoExecutor.ts`) and `scripts/verify-bitget-demo-key.ts` re-tests a key if Bitget ever ships spot demo; until then `official_bitget_demo` never silently falls back to fabricated fills. |
| xPerps | **Disabled module** — not officially verified; refuses to run. |

## Verified universe (live-reconciled)

Exactly five tradeable xStocks, reconciled against the live Bitget symbols API
(`docs/ARCHITECTURE_AUDIT.md`): `AAPLx`, `NVDAx`, `TSLAx` (equities) and the two
BTC-correlated names `MSTRx` (RMSTRUSDT), `COINx` (RCOINUSDT) used by the HEDGE and
CLOSE-ONLY paths. `QQQx` / `SPYx` are index-support proxies. Symbols live in
`packages/bitget-adapter/src/universe.ts`; the market-data client fails loudly if a symbol
returns no data, so a delisted/renamed symbol surfaces as an error, not a fake price.

## The ten trade gates (checkpoint 2)

Earnings window · volatility regime · spread/slippage · liquidation distance ·
confirmation · news first-spike · market session · **xStock premium/discount** ·
BTC correlation · data staleness — plus an always-on known-asset check. Each gate is one
module under `packages/core/src/gates/`, returning `{gate, passed, value, threshold,
effect, reason}` against a single config (`DEFAULT_TRADE_PERMIT_CONFIG`). Verdict
precedence (most severe first): `CLOSE_ONLY > BLOCK > DELAY > HEDGE > REDUCE > APPROVE`.
Full thresholds and effects: `docs/GATE_TABLE.md`.

## Fail-closed doctrine

Stale data → BLOCK · engine exception → BLOCK · unknown asset → BLOCK · missing
confirmation → DELAY · unsafe liquidation distance → REDUCE/BLOCK · a tampered, expired,
replayed, or price-drifted permit → executor refuses. The verdict comes only from the
deterministic gates; the LLM never decides one.

## Bitget toolchain + MCP servers

- **Agent Hub** wrappers (`packages/bitget-adapter/src/agentHub.ts`) and the official
  Demo Trading executor (`demoExecutor.ts`, `paptrading:1`).
- **Skill Hub** perception skills are declared as gate inputs in `docs/GATE_TABLE.md`
  (sentiment-analyst, news-briefing, technical-analysis, macro-analyst).
- **Bitget MCP server** (perception) — `npx -y bitget-mcp-server`, tool surface verified
  from `tools/list`; proven end-to-end by `pnpm verify:bitget-hub`.
- **WardenClaw MCP server** (the firewall itself) — `scripts/warden-mcp-server.ts` exposes
  `audit_strategy`, `request_permit`, `verify_permit`, `get_card`, `replay_card`,
  `get_closeonly_status`, `run_ghost_sim`, so any agent must route trade intent through it.

## Run it

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test     # 283 tests green

# Firewall demos (paper / sim, screenshot-able)
pnpm demo:bypass        # executor can't be reached around: 5 attempts, 4 refused, 1 valid
pnpm demo:closeonly     # survival mode: "buy more" BLOCKED, "reduce 50%" APPROVED
pnpm run:scorecard      # aggregate backtest evidence from real Bitget candles
pnpm evidence:run       # full end-to-end native evidence transcript

# Reactor / perception layer (real Bitget public data, paper fills)
pnpm run:bitget-paper
pnpm console:bitget
pnpm backtest:bitget -- NVDAx
pnpm backtest:all                            # refresh all five verified assets
pnpm verify:bitget-hub                        # prove the Agent Hub MCP integration
pnpm verify:perception                        # prove live perception → gate inputs (no keys)

# Judge dashboard
pnpm --filter @wardenclaw/web dev             # http://localhost:3000/bitget
```

Audit trails (events + full mandates) are written to `data/audit/`; backtests to
`data/backtests/`; scorecard evidence to `output/`. The dashboard reads these real files
directly and shows clean empty states with run instructions when none exist.

## Tests

283 tests across the two packages (174 core + 109 adapter) covering: the Playbook Shield
verdicts; the ten trade gates and their thresholds; the six-way verdict + order rewrite and
verdict precedence; Warden Permit signing/expiry/single-use/drift/replay and the executor's
independent verification; the close-only watcher; ghost-sim counterfactuals; the strategy
compiler clamp (an over-cap LLM proposal is clamped; a disabled LLM falls back to the
deterministic manual strategy); real v2 response parsing and loud failure; the MCP
client/market-data/sentiment envelopes; shock detection, first-spike rejection, cooldown;
paper open/close with labeled simulated fills; ranking; execution-mode selection; the demo
executor (refuses partial credentials, never invents fills); the disabled xPerps module; the
fail-loud Agent Hub; hash-chain integrity; and the backtest PnL/drawdown report.

## Judge dashboard (`apps/web`)

A clean, modern read-only Next.js dashboard (App Router + Tailwind, dark theme, Recharts),
fully responsive for phone viewing. Live at the deployed URL; locally on `/bitget`:

- `/bitget` — overview: execution mode, LLM/Agent-Hub status, xStock universe, paper-mandate
  stats, reject-code breakdown, recent mandates, live console bridge.
- `/bitget/firewall` — the two checkpoints visualized: Playbook Shield verdicts and the
  ten-gate Trade-Permit decision with the signed permit.
- `/bitget/arena` — **Break the Warden**: type a plain-English command, watch it run through
  the real engine (Playbook Shield + ten gates + Warden Permit + counterfactual finale), then
  try to tamper the permit and watch the executor refuse.
- `/bitget/records` — paper settlements and the aggregate scorecard (drawdown with vs without
  WardenClaw, liquidations avoided), computed from real candles.
- `/bitget/mandates` + `/bitget/mandates/[id]` — every Signal Mandate, traded or skipped, with
  decision, economics, risk, watchdog triggers, execution, and proof anchors.
- `/bitget/backtest` — PnL/return/drawdown/win-rate, equity-curve chart, trade table and
  rejections. Retrieval failures stop the run; there is no synthetic fallback.
- `/bitget/replay/[id]` — hash-chain integrity, truth anchors, per-stage outputs, reject codes,
  and an event timeline.

Every view handles loading/empty/error/stale states. It renders only real artifacts from
`data/`; it never fabricates numbers to look fuller.
