# WardenClaw — a command firewall for Bitget xStocks

WardenClaw sits between a trading agent and the exchange. Before a strategy is allowed to run, it gets audited. Before any single trade command goes through, it gets audited again. And every decision is signed so you can prove later why it acted the way it did.

> No valid Warden Permit, no execution. And one step earlier: an unsafe strategy never produces a single trade mandate to begin with.

**Live judge dashboard: https://wardenclaw.duckdns.org/bitget**

Everything here runs on Bitget-native data and tools only — the official Agent Hub, Skill Hub perception skills, and two MCP servers (Bitget's own plus WardenClaw's). No CMC, no Trust Wallet, no BNB SDK, no BSC. The only thing simulated anywhere is the fill: it's real paper trading on real Bitget prices, every fill labeled `internal_paper_engine` / `simulated: true`, never mocked, never dressed up as a real exchange fill.

---

## 1. Idea

### Why I built it

AI trading agents are good strategists and terrible risk managers. Prompt one badly, mis-tune a parameter, or let it hallucinate, and it will happily over-leverage, average down into a loser, buy straight into an earnings spike, or grab a tokenized stock that's trading at a fat premium to the real thing. The agent making those calls is also the only thing standing between you and a blown account, which is exactly the wrong setup.

Generic risk tooling doesn't save you either, because it doesn't know about the traps that are specific to tokenized stocks: the premium or discount a tokenized stock carries against its underlying, US market hours, correlation to BTC. By the time a reckless order actually reaches Bitget, it's already too late to argue with it.

So the idea is simple. Let the agent be the strategist. Don't let it be the last line of defense on risk. Put a deterministic firewall in between, so a bad strategy emits nothing and no individual command goes through without a signed permit that something other than the agent has checked.

### The core hypothesis for tokenized US stocks

A tokenized stock carries two risk profiles stacked on top of each other. It behaves like the equity it tracks — earnings windows, the first spike on news, volatility regime — and it behaves like a crypto asset that trades around the clock and drifts away from its underlying. A risk layer that only understands one of those misses half the danger. WardenClaw's gates are built to cover both, which is why there's a dedicated xStock premium/discount gate and a BTC-correlation gate sitting next to the usual earnings and volatility checks.

### How a decision actually gets made

There are two checkpoints, and the trade has to clear both.

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

**Checkpoint 1 — Playbook Shield** looks at the strategy before it's allowed to run and returns Certified, Restricted, or Rejected. It's five deterministic static checks: leverage, martingale averaging-down, a missing daily-drawdown cap, a missing post-shock cooldown, and entering on earnings or a first spike without confirmation. Restricted doesn't kill the strategy — it hands tightened caps down to the compiler clamp so the strategy runs on a shorter leash. Rejected emits no mandates at all. Details in `docs/PLAYBOOK_SHIELD.md`.

**Checkpoint 2 — Trade-Permit Engine** looks at each trade command and returns one of APPROVE, REDUCE, DELAY, HEDGE, BLOCK, or CLOSE-ONLY. That verdict comes out of ten deterministic gates, including the two asset-class-specific ones (xStock premium/discount, BTC-correlation HEDGE). The LLM's only job here is to parse the command into a structured intent — it never decides the verdict. Details in `docs/GATE_TABLE.md`.

### The signals the gates run on

The ten gates are: earnings window, volatility regime, spread/slippage, liquidation distance, confirmation, news first-spike, market session, xStock premium/discount, BTC correlation, and data staleness — plus an always-on known-asset check. Each one is a single module under `packages/core/src/gates/` that returns `{gate, passed, value, threshold, effect, reason}` against one config (`DEFAULT_TRADE_PERMIT_CONFIG`). When more than one fires, the most severe wins: `CLOSE_ONLY > BLOCK > DELAY > HEDGE > REDUCE > APPROVE`. Full thresholds and effects are in `docs/GATE_TABLE.md`.

The inputs behind those gates are real: per-equity news comes from Yahoo Finance RSS for the underlying stock, the macro/derivatives backdrop (BTC funding, open interest, realized vol) comes from the Agent Hub MCP futures tools, and price/candle data comes from Bitget.

### Where the LLM is, and where it isn't

This is the part that matters most. The LLM reads language and classifies news headlines. That's it. It never touches a verdict. Every risk decision — both checkpoints, all ten gates, the permit lifecycle — is deterministic and fully tested, and the LLM has no path to override it. If there's no LLM and no key configured, news events are honestly reported as absent and the deterministic gates just run on their own.

### Risk management and the fail-closed rule

The default everywhere is to fail closed. Stale data blocks. An engine exception blocks. An unknown asset blocks. A missing confirmation delays. An unsafe liquidation distance reduces or blocks. A permit that's been tampered with, expired, replayed, or drifted off its bound price gets refused by the executor. Every non-BLOCK verdict produces a Warden Permit that's HMAC-SHA256 signed, single-use, expiring, bound to the price it was issued at, and hash-chained to the ones before it. The executor verifies that permit on its own before any paper order goes out, so even if you could reach around the engine, the executor still won't fill an order without a valid permit.

---

## 2. Progress

### What was hard, and how I dealt with it

**Bitget Demo Trading turned out to be futures-only.** I wanted real demo fills for spot xStocks and built the executor for it (`demoExecutor.ts`, `paptrading:1`). The spot `paptrading` endpoints kept returning "exchange environment is incorrect." After verifying it, the conclusion is that Bitget Demo Trading doesn't do spot yet. Rather than quietly fake fills, the system keeps the executor in place and ships `scripts/verify-bitget-demo-key.ts` so the moment Bitget adds spot demo, a key can be re-tested and it lights up. Until then `official_bitget_demo` never silently falls back to invented fills — it just isn't available.

**Keeping the LLM honest.** The whole trust pitch falls apart if the LLM can nudge a risk number. So the strategy compiler clamps every risk value the LLM proposes down to the hard caps and to any Playbook-Shield restriction, and there's a deterministic manual strategy as the fallback when no LLM is configured. There's a test that takes an over-cap LLM proposal and proves it gets clamped, and another that proves a disabled LLM lands on the manual strategy.

**Not faking data anywhere.** The market-data client fails loudly if a symbol returns nothing, so a delisted or renamed symbol shows up as an error instead of a fake price. The dashboard only renders real artifacts from `data/`; when there's nothing to show it shows a clean empty state with run instructions instead of filling the screen with made-up numbers.

### What's real vs. paper

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

### The verified universe

Five tradeable xStocks, reconciled against the live Bitget symbols API (`docs/ARCHITECTURE_AUDIT.md`): `AAPLx`, `NVDAx`, `TSLAx` for the equities, plus the two BTC-correlated names `MSTRx` (RMSTRUSDT) and `COINx` (RCOINUSDT) that drive the HEDGE and CLOSE-ONLY paths. `QQQx` / `SPYx` are index-support proxies. Symbols live in `packages/bitget-adapter/src/universe.ts`.

### What's done

- Both checkpoints, end to end: Playbook Shield (5 checks) and the Trade-Permit Engine (10 gates + the six-way verdict and order rewrite).
- The full Warden Permit lifecycle: signing, expiry, single-use, price-drift binding, replay protection, hash chain, and independent verification by the executor.
- Close-only survival mode, ghost-sim counterfactuals, and a 60-command scorecard computed from real candles.
- The WardenClaw MCP server, so any agent has to route trade intent through the firewall.
- A read-only judge dashboard, deployed and live.
- 283 tests green (174 core + 109 adapter).

### What's still missing / next steps

- Real demo fills for spot xStocks, blocked on Bitget shipping spot Demo Trading. The executor and the key-verifier are already waiting for it.
- xPerps is deliberately disabled until I can verify it officially — right now it refuses to run rather than pretend.
- More underlyings once they're reconciled against the live symbols API; the fail-loud client makes that safe to expand.

### Frameworks, models, APIs

- **Language / runtime:** TypeScript, pnpm workspaces, Node.
- **Tests:** 283 across the two packages (174 core + 109 adapter) covering the Playbook Shield verdicts; the ten gates and their thresholds; the six-way verdict and verdict precedence; permit signing/expiry/single-use/drift/replay and the executor's independent check; the close-only watcher; ghost-sim counterfactuals; the compiler clamp; real v2 response parsing and loud failure; the MCP client / market-data / sentiment envelopes; shock detection, first-spike rejection, cooldown; paper open/close with labeled fills; ranking; execution-mode selection; the demo executor refusing partial credentials; the disabled xPerps module; the fail-loud Agent Hub; hash-chain integrity; and the backtest PnL/drawdown report.
- **Dashboard:** Next.js (App Router), Tailwind, Recharts, dark theme, responsive for phone.
- **Data:** Bitget public v2 REST API; Yahoo Finance public RSS for per-equity news.
- **LLM:** used only to parse commands and classify real headlines — strict structured output, never a risk decision. Works with no LLM at all.

### Bitget tools used

- **Agent Hub** — wrappers in `packages/bitget-adapter/src/agentHub.ts`, plus the Demo Trading executor (`demoExecutor.ts`, `paptrading:1`). Futures tools feed the macro/derivatives backdrop.
- **Playbook** — the strategy entering Checkpoint 1 can come straight from a Bitget Playbook; the Shield audits it before it produces anything.
- **Skill Hub** — perception skills declared as gate inputs in `docs/GATE_TABLE.md` (sentiment-analyst, news-briefing, technical-analysis, macro-analyst).
- **MCP Server** — two of them. Bitget's own `bitget-mcp-server` (`npx -y bitget-mcp-server`, tool surface verified from `tools/list`, proven end to end by `pnpm verify:bitget-hub`), and WardenClaw's own server (`scripts/warden-mcp-server.ts`) exposing `audit_strategy`, `request_permit`, `verify_permit`, `get_card`, `replay_card`, `get_closeonly_status`, `run_ghost_sim`.
- **US Stocks Data API** — not used; xStock prices and symbols come from the Bitget spot market itself, reconciled live against the symbols API.

---

## 3. Materials & links

- **Live dashboard:** https://wardenclaw.duckdns.org/bitget
- **Run it:**

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

- **Where the evidence lands:** audit trails (events + full mandates) in `data/audit/`, backtests in `data/backtests/`, scorecard output in `output/`. The dashboard reads these real files directly.
- **Deeper docs:** `docs/PLAYBOOK_SHIELD.md`, `docs/GATE_TABLE.md`, `docs/ARCHITECTURE_AUDIT.md`, `docs/DEMO_SCRIPT.md`, `docs/COMPLIANCE_CHECKLIST.md`.

### Dashboard pages (`apps/web`)

Read-only, deployed live, and every page handles loading / empty / error / stale states. It only renders real artifacts from `data/`.

- `/bitget` — overview: execution mode, LLM/Agent-Hub status, the xStock universe, paper-mandate stats, reject-code breakdown, recent mandates, live console bridge.
- `/bitget/firewall` — both checkpoints visualized: Playbook Shield verdicts and the ten-gate Trade-Permit decision with the signed permit.
- `/bitget/arena` — **Break the Warden**: type a plain-English command, watch it run through the real engine (Shield + ten gates + permit + counterfactual finale), then try to tamper the permit and watch the executor refuse.
- `/bitget/records` — paper settlements and the scorecard (drawdown with vs. without WardenClaw, liquidations avoided), from real candles.
- `/bitget/mandates` + `/bitget/mandates/[id]` — every Signal Mandate, traded or skipped, with decision, economics, risk, watchdog triggers, execution, and proof anchors.
- `/bitget/backtest` — PnL / return / drawdown / win-rate, equity-curve chart, trade table and rejections. Retrieval failure stops the run; no synthetic fallback.
- `/bitget/replay/[id]` — hash-chain integrity, truth anchors, per-stage outputs, reject codes, event timeline.

---

## 4. AI trading thoughts (optional)

Building this on Bitget's stack, a few things stood out.

The Agent Hub MCP server is the part I'd point other people to first. Having the market-data and futures tools behind a verifiable `tools/list` surface meant I could prove the integration end to end (`pnpm verify:bitget-hub`) instead of trusting that an endpoint does what the docs say. That's underrated for anything risk-related — being able to show a judge the tool surface rather than assert it.

The one rough edge was Demo Trading being futures-only. I spent real time building a spot demo executor before confirming the spot `paptrading` endpoints just aren't there yet. If spot demo lands, a lot of submissions like this one go from "real paper trading on real prices" to "real demo fills," which is a meaningful step up in credibility. The verifier script is sitting there ready for that day.

On agentic trading generally: the more capable the agent gets at strategy, the more important it is that it doesn't also own the risk verdict. An LLM that can talk itself into a trade can talk itself out of a guardrail. The pattern that worked here was to keep the model on perception — read the language, classify the news — and make every actual decision deterministic, signed, and replayable. That separation is what lets you hand the thing to someone skeptical and let them try to break it, which is the whole point of the arena page.
