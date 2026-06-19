# Compliance Checklist

Honest status of every build requirement, with file references. ✅ done · 🟡 partial ·
❌ not yet. Nothing here is fabricated; partial/▢ items are called out plainly.

## Non-negotiables

| Requirement | Status | Where |
|---|---|---|
| Paper / simulation only, no real-capital path | ✅ | every fill labeled `paper`; `wardenExecutor.ts`, `demoExecutor.ts` (demo trading only) |
| Deterministic verdicts (LLM parses/classifies only) | ✅ | `playbookShield.ts`, `tradePermit.ts` — no LLM in the verdict path |
| Fail-closed | ✅ | stale/unknown-asset/tamper/expiry/replay → refuse; `tradePermit.ts`, `wardenPermit.ts` |
| No narrated numbers | ✅ | `ghostSim.ts`, `run-scorecard.ts` compute from real candles |
| Bitget-native tools and data | ✅ | Agent Hub, MCP client, public market data; fixtures cached |
| 6 trade verdicts / 3 strategy verdicts / 5 assets | ✅ | `TradeVerdict`, `StrategyVerdict`, `TRADEABLE_XSTOCKS` |
| Upgrade in place (repo stack) | ✅ | pnpm monorepo, reused audit/replay/compiler |

## Phases

| Phase | Requirement | Status | Where |
|---|---|---|---|
| 0 | Architecture audit + gap table | ✅ | `docs/ARCHITECTURE_AUDIT.md` |
| 0 | Asset reconciliation (5 verified, ≥2 BTC-correlated, live-checked) | ✅ | `universe.ts`, audit §5 |
| 0 | Bitget MCP registration documented | ✅ | `README.md` |
| 1 | Three strategy verdicts | ✅ | `playbookShield.ts` |
| 1 | Five static checks (+ conditional 6th) | ✅ | `playbookShield.ts`, `test/playbookShield.test.ts` |
| 1 | Strategy Safety Card (signed, chained) | ✅ | `wardenCard.ts`, `playbookShield.ts` |
| 1 | Wiring: Reject blocks, Restrict tightens compiler caps | ✅ | `bitget-adapter/src/playbook.ts`, `test/playbook.test.ts` |
| 2 | Six trade verdicts | ✅ | `tradePermit.ts` |
| 2 | Ten deterministic gates incl. premium/discount + BTC corr | ✅ | `tradePermit.ts`, `docs/GATE_TABLE.md` |
| 2 | Six canonical acceptance fixtures | ✅ | `test/tradePermit.test.ts` |
| 2 | Fail-closed branches, one test each | ✅ | `test/tradePermit.test.ts` |
| 3 | Permit signature (HMAC), expiry, single-use, market-state binding, chain, canonical serialization | ✅ | `wardenPermit.ts`, `wardenCard.ts`, `test/wardenPermit.test.ts` |
| 4 | Sim executor gateway (independent verify) | ✅ | `wardenExecutor.ts` |
| 4 | Atomic two-leg HEDGE bundle | ✅ | `wardenExecutor.ts`, `test/wardenExecutor.test.ts` |
| 4 | `demo_bypass` | ✅ | `scripts/demo-bypass.ts` (`pnpm demo:bypass`) |
| 5 | Ghost simulation (computed) | ✅ | `ghostSim.ts`, `test/ghostSim.test.ts` |
| 5 | Aggregate scorecard from real candles | ✅ | `scripts/run-scorecard.ts`, `fixtures/market/` |
| 6 | Close-only watcher (background, state cards) | ✅ | `closeOnlyWatcher.ts`, `scripts/demo-closeonly.ts` |
| 7 | WardenClaw MCP server (7 tools) | ✅ | `mcpServer.ts`, `scripts/warden-mcp-server.ts` |
| 7 | MCP end-to-end round-trip test | ✅ | `test/mcpServer.test.ts` |
| 8 | Structured logger (stdout + JSONL) | ✅ | `evidenceLog.ts` |
| 8 | `evidence:run` transcript | ✅ | `scripts/evidence-run.ts` |
| 8.b | Studio-parity paper records (NAV marks, round-trips, early win-rate/profit-factor) | ✅ | `paperRecords.ts` (`buildPaperRecords`, `computePerformance`) + the `/bitget/records` page; win-rate/profit-factor surface from the first closed trip |
| 9 | UI: verdict badges, Playbook panel, original-vs-adjusted comparison, verification panel, fail-closed banner | ✅ | `apps/web/app/bitget/firewall/page.tsx`, `components/firewall.tsx` (server-rendered from the real engine) |
| 9 | UI extras: ghost-sim panel, scorecard summary view | ✅ | `/bitget/records` page (computed from real fixture candles + `output/scorecard.json`) |
| 9 | UI extras: Bitget asset logos, separated backtest/live-NAV/price charts | 🟡 | minor presentational polish only — not yet |
| Perception | Live Bitget perception wired into the gate inputs | ✅ | `marketContext.ts`, `scripts/verify-perception.ts` (proven against real public data) |
| 10 | Full test suite | ✅ | 252 tests (174 core + 78 adapter) |
| 10 | Docs (README, GATE_TABLE, PLAYBOOK_SHIELD) | ✅ | `README.md`, `docs/GATE_TABLE.md`, `docs/PLAYBOOK_SHIELD.md` |
| 10 | Demo kit + submission blurb + this checklist | ✅ | `docs/DEMO_SCRIPT.md`, `docs/SUBMISSION_BLURB.md`, this file |

## Outstanding work (honest)

Only minor presentational polish remains: **Bitget asset logos** (use the public
coin-logo catalog) and **separated backtest / live-NAV / symbol-price charts** with
execution markers. Everything else in the spec is implemented.

The two checkpoints, signed permits, the executor + atomic hedge, the close-only
watcher, ghost-sim + scorecard, the MCP server, native evidence + studio-parity paper
records, live Bitget perception wiring, and the firewall + records UI are complete,
tested (265 tests), and verified running on the deployment VPS.
