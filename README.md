# RUNECLAW

> RUNECLAW turns natural-language trading strategies into risk-bound Signal Mandates that can trade, survive, and prove why they acted.

One shared deterministic core, two focused submissions:

- **RUNECLAW Stocks** — a Bitget-native paper-trading agent that reacts to tokenized-equity earnings/news/sentiment shocks under deterministic risk gates.
- **RUNECLAW BSC** — a live, self-custodial, spot-only BSC trading agent that reads markets via CoinMarketCap, signs through Trust Wallet Agent Kit, and optimizes total return under a drawdown cap from a $40 book.

## Status

Both submissions are built. The shared TypeScript core is the source of truth for
the frontend, backend, and worker. External integrations (Bitget public data, CMC
Agent Hub + x402, Trust Wallet Agent Kit, BNB AI Agent SDK, PancakeSwap) are real
adapters that fail loudly when unconfigured — never faked. ~190 tests pass;
`typecheck`, `lint`, and the Next.js build are green.

### What's implemented

- **`packages/core`** — the deterministic engine: Signal Mandate schema, risk
  config, friction model (real + simulated), net-edge gate, volatility stops +
  coherence, three-layer drawdown governor, shadow-fill guard, calibration mapping,
  address-keyed eligible allowlist, scorer, Risk Constitution, hash-chained audit,
  replay, recovery, hourly snapshots, mandate store, LLM provider layer.
- **Bitget submission** — `packages/bitget-adapter` (real public market data,
  shock/cooldown reactor with first-spike rejection, internal paper engine,
  ranker, agent stack, backtest) + `apps/web` `/bitget` judge dashboard.
- **BNB submission** — `packages/{cmc,twak,bsc}-adapter` + `packages/bnb-agent`
  (the full gate-chain pipeline, scheduler, runtime ops), `apps/api` (kill-switch),
  `apps/worker` (recovery + loop + snapshots), `apps/web` `/bsc` dashboards incl.
  the `/bsc/proof` judge scoreboard.

Docs: `docs/{SETUP,COMPETITION_RULES,BITGET_SUBMISSION,BNB_SUBMISSION,SPECIAL_PRIZES,
SAFETY,LLM_POLICY,ECONOMICS,OPERATIONS,PREFLIGHT,SELF_AUDIT}.md`. Start with
`docs/SETUP.md`.

## Develop

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test
pnpm demo:twak-refusal              # see TWAK refuse bad trades
pnpm --filter @runeclaw/web dev     # dashboards on http://localhost:3000
```

## Safety

This is hackathon trading, not investment advice. BSC execution is **spot-only** by team decision. Private keys never touch the backend or database — signing is local through Trust Wallet Agent Kit. Every trade decision produces a structured, replayable audit event.

## Environment

Copy `.env.example` to `.env` and fill in the values you need. Every variable is documented inline.
