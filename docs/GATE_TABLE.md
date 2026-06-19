# Gate Table — Trade-Permit Engine

Checkpoint 2 of the firewall. Each TRADE command (parsed into a structured intent by
the LLM layer — **parsing only, never risk**) runs through these ten deterministic
gates. Every gate returns `{gate, passed, value, threshold, effect, reason}`. All
thresholds live in one config: `TradePermitConfig` (`packages/core/src/tradePermit.ts`,
`DEFAULT_TRADE_PERMIT_CONFIG`). The LLM never decides a verdict.

| Gate | Input source (skill / API) | Default threshold | Effect |
|---|---|---|---|
| Earnings window | news-briefing / earnings calendar | within ±48h of earnings | BLOCK if leverage > 2×, else REDUCE |
| Volatility regime | technical-analysis (ATR / realized vol) | vol > 80th pct of 90d | REDUCE size ≥50%, cap leverage at 2× |
| Spread / slippage | Bitget orderbook API | spread > 50 bps | DELAY |
| Liquidation distance | computed: leverage, maintenance margin | distance < 8% REDUCE; < 4% BLOCK | REDUCE or BLOCK |
| Confirmation | technical-analysis | post-news volume/candle confirmation missing | DELAY |
| News first-spike | news-briefing timestamps | command < 15 min after a shock | DELAY |
| Market session | exchange clock vs NYSE hours | US market closed | tightens the premium gate (never blocks alone) |
| **xStock premium/discount** | xStock price vs underlying ref/last close | abs(premium) > 1.5% (0.75% overnight/closed) REDUCE; > 3% DELAY | **the asset-class-native gate** — REDUCE or DELAY |
| BTC correlation | macro-analyst | asset ∈ correlated set AND BTC realized vol rising | HEDGE |
| Data staleness | all feeds | any required feed older than 60s | BLOCK (fail-closed) |

Plus an always-on **known-asset** check: an asset outside the verified five → BLOCK.

## The six verdicts

| Verdict | Meaning | Order effect |
|---|---|---|
| **APPROVE** | passes all required gates | executes as requested |
| **REDUCE** | idea valid, command too aggressive | engine **rewrites** the order (smaller size, lower leverage, market→limit) and approves that |
| **DELAY** | not rejected, not now | returns a concrete recheck condition |
| **HEDGE** | approved only with protection | smaller primary + an enforced `hedge_leg` (atomic two-leg bundle in the executor) |
| **BLOCK** | fails a major gate | nothing executes, no permit |
| **CLOSE_ONLY** | account survival mode | only reduce/close/cancel permitted; exposure-increasing commands refused |

## Verdict precedence (most severe first)

```
CLOSE_ONLY(context) > BLOCK > DELAY > HEDGE > REDUCE > APPROVE
```

- `CLOSE_ONLY` is account-level: while the close-only watcher has flipped survival
  mode, any exposure-increasing command is refused regardless of the gates.
- `BLOCK` dominates everything else — a command that trips earnings + leverage + vol +
  liquidation at once is BLOCKED, not reduced.
- A REDUCE rewrite applies the **most conservative** of all firing reductions and never
  widens risk (leverage only down, size only down, market only → limit).

## Fail-closed doctrine

Stale data → BLOCK · engine exception → BLOCK · unknown asset → BLOCK · missing
confirmation → DELAY · unsafe liquidation → REDUCE/BLOCK. The verdict comes only from
these deterministic gates.

## Live perception wiring

The gate inputs are assembled from REAL Bitget perception by
`packages/bitget-adapter/src/marketContext.ts`:

- `gatherPerception(source, symbol, …)` fetches the ticker + candles from a live
  `MarketDataSource` (public HTTP `BitgetPublicMarketData` or the Bitget MCP server
  `BitgetMcpMarketData`) and assembles the `MarketContext`.
- `buildMarketContext(…)` is the pure assembly: price + feed staleness from the
  ticker, the realized-vol percentile and the premium "last close" reference from the
  candles, the NYSE session from the clock, the BTC-correlation flag from the verified
  universe, and the optional declared-source signals (earnings calendar, news-shock
  timestamps, orderbook spread, BTC realized vol) passed through from their skills.
- A missing feed leaves its field undefined so the dependent gate stays
  conservative/closed — never fabricated.

Prove it live (real public data, no keys): `pnpm verify:perception`.

## Code & tests

- `packages/core/src/tradePermit.ts` — the gates, the config, and `evaluateTradePermit`.
- `packages/core/test/tradePermit.test.ts` — the six canonical acceptance fixtures, the
  fail-closed branches, and per-gate threshold tests.
- `packages/bitget-adapter/src/marketContext.ts` + `test/marketContext.test.ts` — the
  live perception → gate-input wiring.
