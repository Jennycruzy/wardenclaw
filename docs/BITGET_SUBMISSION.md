# WARDENCLAW Stocks — xStock Earnings/News Reactor (Bitget)

A Bitget-native paper-trading agent that monitors tokenized US equities, reacts
to earnings/news/sentiment shocks **without chasing the first spike**, paper-trades
through deterministic configurable risk gates, and gives judges a replayable
audit trail.

> Because tokenized equities can be monitored continuously, WARDENCLAW reacts to
> after-hours earnings/news/sentiment shocks faster than a human — but is
> disciplined enough not to buy the first fake spike.

This submission uses **Bitget-native data and tools only**. No CMC, no Trust
Wallet, no BNB SDK, no BSC. Paper trading is the only simulation allowance in the
whole system, and it is **real paper trading on real Bitget prices** — never
static mock data, and never presented as a real exchange fill.

## What is real vs. paper

| Layer | Status |
|---|---|
| Market data | **Real** — two interchangeable sources: the official **Bitget Agent Hub MCP server** (`bitget-mcp-server@1.1.0`, spawned over stdio; tool surface verified via `tools/list`) and the Bitget public v2 REST API. Both fail loudly if a symbol returns nothing. |
| xStock symbols | **Verified** against the live Bitget spot API (2026-06-11): tokenized equities trade under the `<TICKER>ON` convention (e.g. `NVDAONUSDT`). |
| Per-equity news | **Real** — Yahoo Finance public RSS for each underlying US stock; the configured LLM classifies real headlines only (strict structured output). No LLM, no key → events are honestly absent, deterministic gates run alone. |
| Derivatives risk backdrop | **Real** — BTC funding rate + open interest from the Agent Hub MCP futures tools, mapped deterministically to a risk regime. |
| Strategy compilation | **Real** — the NL strategy compiles to deterministic JSON at startup (LLM proposes when configured; every risk number is clamped to the hard caps; a deterministic manual strategy is the fallback). The compiled JSON is recorded on every mandate. |
| Shock/cooldown/ranking/watchdog logic | **Real**, deterministic, fully tested. |
| Risk gates | **Real**, deterministic; the LLM cannot bypass them. |
| Execution | **Paper** — internal paper engine, every fill labeled `internal_paper_engine` / `simulated: true`. |
| Official Bitget Demo Trading | **Implemented but unusable for spot xStocks** — verified 2026-06-11 (support article 12560603790031) that Bitget Demo Trading is **futures-only**; spot endpoints under `paptrading` return "exchange environment is incorrect". The executor exists (`demoExecutor.ts`) and `scripts/verify-bitget-demo-key.ts` re-tests a key if Bitget ever ships spot demo; until then `official_bitget_demo` never silently falls back to fabricated fills. |
| xPerps | **Disabled module** — not officially verified; refuses to run. |

## The xStock universe

`AAPLx, NVDAx, TSLAx, MSFTx` (tradeable) + `QQQx, SPYx` (index-support proxies).
Symbols live in `packages/bitget-adapter/src/universe.ts`, verified against
`GET /api/v2/spot/public/symbols`. The market-data client fails loudly if a
symbol returns no data, so a delisted/renamed symbol surfaces as an error, not a
fake price.

## The strategy — earnings/news shock continuation with post-event cooldown

1. Compile the natural-language strategy into deterministic JSON
   (StrategyCompilerAgent; risk numbers clamped to hard caps).
2. Detect an earnings/news/volatility shock from **real price + volume**.
3. **Reject the first spike bar** — no chasing (`REJECT_FIRST_SPIKE`).
4. Wait out a **post-event cooldown** to confirm continuation.
5. Require **sentiment and technical direction to agree** when news is present
   (`REJECT_SENTIMENT_CONFLICT`).
6. Require **index (QQQ/SPY) support** (`REJECT_INDEX_HOSTILE`).
7. Reject unverified rumors (`REJECT_EVENT_UNCLEAR`).
8. Score the setup deterministically (`scoreBitget`); only a high-enough score
   becomes an entry (`REJECT_LOW_SCORE`).
9. Rank confirmed candidates; paper-trade the strongest one with a
   volatility-derived stop and size.
10. The **watchdog** manages the position with four armed triggers, each
    recorded on the mandate and audited when fired: the volatility stop, the
    profit target, the **sentiment-reversal exit** ("exit if sentiment
    reverses" — a high-confidence negative classified event closes the long),
    and the max-hold time exit.
11. Every stage writes a hash-chained JSONL audit event.

The LLM may compile the natural-language strategy into deterministic JSON and
classify real news into structured catalyst objects — it **never** decides an
entry, invents a price, or fabricates news.

## The agent stack (§4.4)

`StrategyCompilerAgent` (NL → clamped deterministic JSON at startup) →
`BitgetMarketAgent` (real market data: Agent Hub MCP or public REST) →
`StockNews/Sentiment/Macro/TechnicalSignal` (real perception: Yahoo RSS news +
LLM classifier, funding/OI risk backdrop, price-structure technicals) →
`EventShockRanker` → `RiskMandateAgent` (deterministic paper gates) →
`PaperExecutionAgent` (labeled fills) → `WatchdogAgent` (stop / target /
sentiment-reversal / time exits, audited) → `AuditReplayAgent`.

## Run it

```bash
pnpm install

# Paper-trade against real Bitget public data (one cycle by default)
pnpm run:bitget-paper
# multi-cycle polling:
BITGET_CYCLES=10 BITGET_POLL_SECONDS=60 pnpm run:bitget-paper

# Interactive live console — full-screen scanner cockpit with keyboard control
# ([space] pause, [t] trading on/off, [f] scan now, [x] close all, [q] quit) and
# a `:` command bar (buy/close/news/tp/mag/hold/score/interval — type :help).
# Real per-equity news (Yahoo Finance RSS for each underlying) is fetched live
# and classified by the configured LLM into the reactor's sentiment gate.
pnpm console:bitget

# Backtest the reactor (real symbol, or synthetic fallback if unavailable)
pnpm backtest:bitget -- NVDAONUSDT
pnpm backtest:bitget            # synthetic shock-and-run series

# Prove the Agent Hub MCP integration end-to-end
pnpm verify:bitget-hub

# Judge dashboard
pnpm --filter @wardenclaw/web dev   # http://localhost:3000/bitget
```

Audit trails (events + full mandates) are written to `data/audit/`; backtest
reports to `data/backtests/`. The dashboard reads these real files directly and
shows clean empty states with run instructions when none exist.

## Execution mode is always shown

`selectExecutionMode` resolves to one of `official_bitget_demo` /
`internal_paper_engine` / `backtest`, and the mode is labeled on the dashboard,
on every mandate, and on every fill. Because Bitget Demo Trading is verified
futures-only (see table above), the agent runs the internal paper engine on real
Bitget market data; requesting `official_bitget_demo` without a working demo
credential set fails loudly and falls back with a clear message — never with
fabricated fills.

## Tests

165 tests across the two packages (90 core + 75 adapter) covering: real v2
response parsing and loud failure; the MCP client/market-data/sentiment
envelopes; shock detection; first-spike rejection; cooldown; sentiment/index/
rumor/stale gates; confirmed entry; the watchdog (stop, profit target,
sentiment-reversal, max-hold, trigger priority); strategy compilation with
hard-cap clamping (an over-cap LLM proposal is clamped, a disabled LLM falls
back to the deterministic manual strategy); paper open/close with labeled
simulated fills; mark-to-market equity; ranking; execution-mode selection; the
demo executor (refuses partial credentials, never invents fills); the disabled
xPerps module; the fail-loud Agent Hub; hash-chain integrity; and the backtest
PnL/drawdown report.

## Judge dashboard (`apps/web`)

A clean, modern read-only Next.js dashboard (App Router + Tailwind, dark theme,
Recharts), fully responsive for phone viewing:

- `/bitget` — overview: execution mode, LLM/Agent-Hub status, xStock universe,
  paper-mandate stats, reject-code breakdown chart, recent mandates, live console
  bridge.
- `/bitget/mandates` — every Signal Mandate, traded or skipped.
- `/bitget/mandates/[id]` — full mandate: decision, economics (net-edge), risk,
  watchdog triggers, execution (with the labeled simulated fill), perception +
  proof anchors.
- `/bitget/backtest` — PnL/return/drawdown/win-rate, equity-curve chart, trade
  table, rejections; the source (real vs. synthetic) is labeled.
- `/bitget/replay/[id]` — hash-chain integrity, truth anchors, per-stage outputs
  (including fired watchdog triggers), reject codes, and an event timeline.

Every view handles loading/empty/error/stale states. It renders only real
artifacts from `data/`; it never fabricates numbers to look fuller.
