# SAFETY

This is hackathon **paper trading**, not investment advice, and not a real-money
system. This document states the safety properties of the WARDENCLAW command
firewall for Bitget xStocks (and the paper reactor underneath) and where each one
is enforced.

## No real orders, ever

- The reactor never places a real exchange order. Fills are simulated against
  real Bitget market data by the internal paper engine and are always labeled
  `source: "internal_paper_engine"`, `simulated: true`
  (`packages/bitget-adapter/src/paperEngine.ts`).
- The official Bitget Demo Trading executor exists (`demoExecutor.ts`) but demo
  trading is verified **futures-only** on Bitget, so it cannot run for spot
  xStocks. Selecting `official_bitget_demo` without working demo credentials
  fails loudly; an agent constructed in demo mode without an executor throws —
  it never silently paper-fills under a demo label (`agents.ts` constructor).

## Deterministic configurable risk gates

The LLM can propose; only deterministic code decides. Every entry passes, in
order: fresh feed → paper-fill source present → reactor approval (no first
spike, post-event cooldown elapsed, no sentiment/technical conflict, no
unverified rumor, index support, score ≥ threshold) → exposure cap → net-edge
quality filter → volatility-derived sizing. Each rejection writes a typed
reject code (`REJECT_FIRST_SPIKE`, `REJECT_SENTIMENT_CONFLICT`,
`REJECT_INDEX_HOSTILE`, `REJECT_EVENT_UNCLEAR`, `REJECT_LOW_SCORE`,
`REJECT_STALE_FEED`, …) to the hash-chained audit log.

Open positions are protected by the watchdog (`packages/core/src/watchdog.ts`):
volatility stop, profit target, sentiment-reversal exit, max-hold time exit.
Triggers are armed on the mandate at entry and audited when fired.

## What the LLM may and may not do

May: compile the NL strategy into deterministic JSON (clamped to hard caps —
see `strategyCompiler.ts` `clampRiskLimits`), classify **real fetched
headlines** into structured events, summarize audit logs.

May not: decide an entry, size a position, approve execution, bypass any gate,
or invent prices/news/fills. All LLM output is schema-validated; invalid output
is rejected and the system degrades to deterministic mode. With no API key the
whole agent runs deterministically (`LLM disabled: deterministic/manual mode`).

## Fail-loud, never fabricate

Every external integration (Bitget public REST, Agent Hub MCP server, Yahoo
Finance RSS) throws a typed error on missing/invalid data. A symbol that
returns nothing is an error, not a price. An unconfigured Agent Hub source
refuses every call with a clear TODO (`agentHub.ts`).

## Keys and secrets

- No private keys exist in this system (paper trading only).
- Bitget API credentials are optional (public market data needs none), live in
  `.env` (gitignored), and are never written to the database or audit logs.
- The dashboard command bridge can be token-gated via `DASHBOARD_COMMAND_TOKEN`.

## Stop controls

- `REACTOR_PAUSED=true` in `.env` pauses mandate generation on the next poll
  cycle without restarting anything (read live each cycle by both the paper
  runner and the console).
- The interactive console has `[space]` pause, `[t]` trading off, and
  `:close all` to flatten the paper book.

## Audit and replay

Every meaningful event is appended to hash-chained JSONL with stage, inputs,
outputs, and proof anchors. The hash chain proves **log integrity**, not market
truth; truth anchors (market-data timestamps, paper-fill source labels, demo
order ids when applicable) tie events to their real-world inputs. Any mandate
is replayable at `/bitget/replay/[id]` or via `pnpm replay --mandate <id>`.
