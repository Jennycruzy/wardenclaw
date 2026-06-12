# WARDENCLAW — Bitget xStock Reactor

> WARDENCLAW turns natural-language trading ideas into risk-bound **Signal Mandates** that react to
> tokenized-equity (xStock) earnings/news/sentiment shocks on Bitget — and prove why they acted.

A Bitget-native **paper-trading** agent. It reads real Bitget public market data for the xStock
universe, detects earnings/news/sentiment shocks, and runs every candidate trade through a
deterministic, configurable risk gate before a simulated fill. Every decision becomes a
hash-chained, replayable audit event you can inspect in the dashboard.

## Status

Built and green: `typecheck`, `lint`, the test suite, and the Next.js build all pass. External
integrations (Bitget public market data, the official Bitget Agent Hub MCP server, per-equity Yahoo
Finance news) are **real adapters that fail loudly when unconfigured — never faked**. Fills are
simulated paper fills on real market data, and are always labeled as such.

## What's implemented

- **`packages/core`** — the deterministic engine: Signal Mandate schema, configurable risk config,
  friction model (real + simulated), net-edge gate, volatility stops + coherence, drawdown governor,
  shadow-fill guard, score→expected-move calibration, scorer, Risk Constitution, hash-chained audit,
  replay, mandate store, backtester, and the LLM provider layer.
- **`packages/bitget-adapter`** — real public market data, the shock/cooldown reactor with
  first-spike rejection, the internal paper engine, the event-shock ranker, the agent stack, the
  optional Agent Hub MCP perception source, and the backtest harness.
- **`apps/web`** — the `/bitget` judge dashboard: overview, mandates list + per-mandate replay,
  backtest report, and a live console bridge.
- **LLM policy** — the LLM only *proposes* (strategy compilation, news-sentiment classification,
  audit summaries); the deterministic gates always decide. A disabled/manual mode is fully supported.

Docs: `docs/{SETUP,BITGET_SUBMISSION,LLM_POLICY}.md`. Start with `docs/SETUP.md`.

## Develop

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test
pnpm run:bitget-paper                  # run the reactor on real Bitget data (paper fills)
pnpm console:bitget                    # interactive live console
pnpm backtest:bitget                   # backtest over real historical candles
pnpm verify:bitget-hub                 # prove the Agent Hub MCP integration end-to-end
pnpm --filter @wardenclaw/web dev      # dashboard on http://localhost:3000
```

## Safety

This is hackathon paper trading, not investment advice. The reactor never places real exchange
orders: fills are simulated against real Bitget market data and are always labeled
`internal_paper_engine`. Every trade decision produces a structured, replayable audit event.

## Environment

Copy `.env.example` to `.env` and fill in the values you need. Every variable is documented inline.
The agent runs with no LLM key (deterministic mode) and with no Bitget API key (public data only).
