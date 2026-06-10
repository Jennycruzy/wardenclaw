# RUNECLAW

> RUNECLAW turns natural-language trading strategies into risk-bound Signal Mandates that can trade, survive, and prove why they acted.

One shared deterministic core, two focused submissions:

- **RUNECLAW Stocks** — a Bitget-native paper-trading agent that reacts to tokenized-equity earnings/news/sentiment shocks under deterministic risk gates.
- **RUNECLAW BSC** — a live, self-custodial, spot-only BSC trading agent that reads markets via CoinMarketCap, signs through Trust Wallet Agent Kit, and optimizes total return under a drawdown cap from a $40 book.

## Status

Build in progress. The shared TypeScript core is implemented and tested first, as the source of truth for the frontend, backend, and worker. External integrations (Bitget Agent Hub, CMC Agent Hub + x402, Trust Wallet Agent Kit, BNB AI Agent SDK, PancakeSwap) are real adapters that fail loudly when unconfigured — never faked.

### What's implemented

`packages/core` — the deterministic engine, fully unit-tested:

- Signal Mandate type + runtime Zod schema
- Configurable risk parameters with strict env loading
- Friction model (real cost + simulated scoring cost)
- Net-edge gate
- Volatility-derived stops with size-coherence check
- Three-layer drawdown governor (competition / window / daily)
- Shadow-fill guard
- Score → expected-move calibration mapping
- Address-keyed eligible-token allowlist (native BNB / WBNB never held)
- Deterministic signal scorer (BSC + Bitget)
- Risk Constitution gate chain
- Append-only JSONL audit logger with hash chaining

## Develop

```bash
pnpm install
pnpm -r typecheck
pnpm -r test
```

## Safety

This is hackathon trading, not investment advice. BSC execution is **spot-only** by team decision. Private keys never touch the backend or database — signing is local through Trust Wallet Agent Kit. Every trade decision produces a structured, replayable audit event.

## Environment

Copy `.env.example` to `.env` and fill in the values you need. Every variable is documented inline.
