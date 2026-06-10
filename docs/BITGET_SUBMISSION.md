# RUNECLAW Stocks — xStock Earnings/News Reactor (Bitget)

A Bitget-native paper-trading agent that monitors tokenized US equities, reacts
to earnings/news/sentiment shocks **without chasing the first spike**, paper-trades
through deterministic configurable risk gates, and gives judges a replayable
audit trail.

> Because tokenized equities can be monitored continuously, RUNECLAW reacts to
> after-hours earnings/news/sentiment shocks faster than a human — but is
> disciplined enough not to buy the first fake spike.

This submission uses **Bitget-native data and tools only**. No CMC, no Trust
Wallet, no BNB SDK, no BSC. Paper trading is the only simulation allowance in the
whole system, and it is **real paper trading on real Bitget prices** — never
static mock data, and never presented as a real exchange fill.

## What is real vs. paper

| Layer | Status |
|---|---|
| Market data | **Real** — Bitget public v2 REST API (`/api/v2/spot/market/tickers`, `/candles`). No auth needed for public data. Fails loudly if a symbol returns nothing. |
| Shock/cooldown/ranking logic | **Real**, deterministic, fully tested. |
| Risk gates | **Real**, deterministic; the LLM cannot bypass them. |
| Execution | **Paper** — internal paper engine, every fill labeled `internal_paper_engine` / `simulated: true`. |
| Agent Hub news/sentiment/macro | **Not verified** in this environment — the adapter fails loudly with a clear TODO rather than fabricating perception. Inject a real source via `InjectedAgentHub` when available. |
| xPerps | **Disabled module** — not verified; refuses to run. |

## The xStock universe

`AAPLx, NVDAx, TSLAx, MSFTx` (tradeable) + `QQQx, SPYx` (index-support proxies).

The Bitget API symbols in `packages/bitget-adapter/src/universe.ts` are best-effort
and marked **NEEDS VERIFICATION** — the market-data client fails loudly if a symbol
returns no data, so an unverified symbol surfaces as an error, not a fake price.
Verify the Bitget xStocks/Stocks 2.0 symbol convention before a live paper run.

## The strategy — earnings/news shock continuation with post-event cooldown

1. Detect an earnings/news/volatility shock from **real price + volume**.
2. **Reject the first spike bar** — no chasing (`REJECT_FIRST_SPIKE`).
3. Wait out a **post-event cooldown** to confirm continuation.
4. Require **sentiment and technical direction to agree** when news is present
   (`REJECT_SENTIMENT_CONFLICT`).
5. Require **index (QQQ/SPY) support** (`REJECT_INDEX_HOSTILE`).
6. Reject unverified rumors (`REJECT_EVENT_UNCLEAR`).
7. Score the setup deterministically (`scoreBitget`); only a high-enough score
   becomes an entry (`REJECT_LOW_SCORE`).
8. Rank confirmed candidates; paper-trade the strongest one with a
   volatility-derived stop and size.
9. Watchdog manages/exits the position.
10. Every stage writes a hash-chained JSONL audit event.

The LLM may compile the natural-language strategy into deterministic JSON and
classify real news into structured catalyst objects — it **never** decides an
entry, invents a price, or fabricates news.

## The agent stack (§4.4)

`BitgetMarketAgent` (real market data) → `StockNews/Sentiment/Macro/TechnicalSignal`
(real perception, fail-loud when Agent Hub is absent) → `EventShockRanker` →
`RiskMandateAgent` (deterministic paper gates) → `PaperExecutionAgent` (labeled
fills) → `WatchdogAgent` → `AuditReplayAgent`.

## Run it

```bash
pnpm install

# Paper-trade against real Bitget public data (one cycle by default)
pnpm run:bitget-paper
# multi-cycle polling:
BITGET_CYCLES=10 BITGET_POLL_SECONDS=60 pnpm run:bitget-paper

# Backtest the reactor (real symbol, or synthetic fallback if unavailable)
pnpm backtest:bitget -- NVDAXUSDT
pnpm backtest:bitget            # synthetic shock-and-run series
```

Audit trails are written to `data/audit/`; backtest reports to `data/backtests/`.

## Execution mode is always shown

`selectExecutionMode` resolves to one of `official_bitget_demo` /
`internal_paper_engine` / `backtest`. The official Bitget demo executor is **not
implemented** (endpoints unverified) and throws a clear error if selected — it
never silently falls back to fabricated fills. Until verified, the agent runs the
internal paper engine on real Bitget market data.

## Tests

`packages/bitget-adapter` ships 38 tests covering: real v2 response parsing and
loud failure; shock detection; first-spike rejection; cooldown; sentiment/index/
rumor/stale gates; confirmed entry; paper open/close with labeled simulated fills;
mark-to-market equity; ranking; execution-mode selection; the disabled xPerps
module; the fail-loud Agent Hub; and the backtest PnL/drawdown report.

## Still to build for this submission

The clean, modern read-only **judge dashboard** (`/bitget`, `/bitget/mandates`,
`/bitget/mandates/:id`, `/bitget/backtest`, `/bitget/replay/:id`) per §0.14 and
§4.7 — the engine, audit, and replay data it renders are already produced here.
