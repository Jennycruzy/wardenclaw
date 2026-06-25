# Compliance Checklist

Honest status of every build requirement, with file references. ✅ done · 🟡 partial ·
❌ not yet. Nothing here is fabricated; partial/▢ items are called out plainly.

## Non-negotiables

| Requirement | Status | Where |
|---|---|---|
| Paper / simulation only, no real-capital path | ✅ | every fill labeled `paper`; `wardenExecutor.ts`, `demoExecutor.ts` (demo trading only) |
| Deterministic verdicts (LLM parses/classifies only) | ✅ | `playbookShield.ts`, `tradePermit.ts` — no LLM in the verdict path |
| Fail-closed | 🟡 | permit/executor modules fail closed, but the live reactor still opens/closes `PaperBook` directly instead of passing every fill through `WardenExecutor` |
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
| 2 | Ten deterministic gates incl. premium/discount + BTC corr | ✅ | `packages/core/src/gates/` (one module per gate), composed by `tradePermit.ts`, `docs/GATE_TABLE.md` |
| 2 | Six canonical acceptance fixtures | ✅ | `test/tradePermit.test.ts` |
| 2 | Fail-closed branches, one test each | ✅ | `test/tradePermit.test.ts` |
| 3 | Permit signature (HMAC), expiry, single-use, market-state binding, chain, canonical serialization | ✅ | `wardenPermit.ts`, `wardenCard.ts`, `test/wardenPermit.test.ts` |
| 4 | Sim executor gateway (independent verify) | 🟡 | `wardenExecutor.ts` and bypass tests are complete; live reactor integration is still missing |
| 4 | Atomic two-leg HEDGE bundle | ✅ | `wardenExecutor.ts`, `test/wardenExecutor.test.ts` |
| 4 | `demo_bypass` | ✅ | `scripts/demo-bypass.ts` (`pnpm demo:bypass`) |
| 5 | Ghost simulation (computed) | ✅ | `ghostSim.ts`, `test/ghostSim.test.ts` |
| 5 | Aggregate scorecard from real candles | 🟡 | deterministic real-candle scenario scorecard exists, but “max drawdown” is currently a sum of scenario drawdowns rather than one portfolio equity-curve max drawdown; HEDGE scorecard PnL omits the protective leg |
| 6 | Close-only watcher (background, state cards) | 🟡 | controller + signed cards + demo exist; it is not yet polled by the live console/paper-agent loop |
| 7 | WardenClaw MCP server (7 tools) | ✅ | `mcpServer.ts`, `scripts/warden-mcp-server.ts` |
| 7 | MCP end-to-end round-trip test | ✅ | `test/mcpServer.test.ts` |
| 8 | Structured logger (stdout + JSONL) | ✅ | `evidenceLog.ts` |
| 8 | `evidence:run` transcript | ✅ | `scripts/evidence-run.ts` |
| 8.b | Studio-parity paper records (NAV marks, round-trips, early win-rate/profit-factor) | 🟡 | current book persists and one exact historical settlement is recovered; three pre-persistence entries remain unresolved because no exit event exists |
| 9 | UI: verdict badges, Playbook panel, original-vs-adjusted comparison, verification panel, fail-closed banner | ✅ | `/bitget/arena` ("Break the Warden") takes a plain-English command and runs it through the real engine (both checkpoints + permit + adversary attacks + original-vs-adjusted finale) via `/api/bitget/arena`; `/bitget/firewall` renders the two-checkpoint decision. Verdict badges + fail-closed banner in `apps/web/components/firewall.tsx` |
| 9 | UI extras: ghost-sim panel, scorecard summary view | ✅ | `/bitget/records` page (computed from real fixture candles + `output/scorecard.json`) |
| 9 | UI extras: separated backtest/live-NAV/price charts with execution markers | ❌ | backtest equity curve exists; current live-NAV and real execution-marker charts are not implemented |
| 9 | UI extras: Bitget asset logos | ⚠️ documented deviation | Bitget coins API exposes no logo URL and the image catalog is hotlink-protected (403, hashed filenames) — verified 2026-06-20; branded monogram retained with a `src` hook (`apps/web/components/asset-logo.tsx`). See `ARCHITECTURE_AUDIT.md §8.5` |
| Perception | Live Bitget perception wired into the gate inputs | ✅ | `marketContext.ts`, `scripts/verify-perception.ts`; live `perception source: live_bitget_agent_hub_mcp` on the VPS |
| Hardening | Transient 429 retry (REST + MCP), deterministic news fallback | ✅ | `retry.ts`, `mcpMarketData.ts`, `newsFeed.classifyNewsDeterministic`; see `ARCHITECTURE_AUDIT.md §8` |
| Ops | Automated real-candle backtest refresh | ✅ | `scripts/refresh-bitget-backtests.ts`, `ops/warden-backtests.{service,timer}` |
| 10 | Full test suite | ✅ | 283 tests green (174 core + 109 adapter), verified 2026-06-25 |
| 10 | Docs (README, GATE_TABLE, PLAYBOOK_SHIELD) | ✅ | `README.md`, `docs/GATE_TABLE.md`, `docs/PLAYBOOK_SHIELD.md` |
| 10 | Demo kit + submission blurb + this checklist | ✅ | `docs/DEMO_SCRIPT.md`, `docs/BITGET_SUBMISSION.md`, this file |

## Outstanding work (honest)

The isolated firewall modules, tests, demos, MCP tools, signed cards, and live
perception are working. The remaining prompt-level gaps are material:

1. Route live reactor entry/exit execution through signed permits and
   `WardenExecutor`; direct `PaperBook.open/close` calls do not satisfy the
   command-firewall invariant.
2. Integrate `CloseOnlyController` into the continuous live position loop and
   enforce its state at permit issuance and execution.
3. Rework the scorecard to calculate portfolio equity-curve maximum drawdown,
   include both HEDGE legs, and anchor event scenarios to recorded real events.
4. Add the missing live-NAV and real execution-marker charts (the interactive
   command input/action is now live at `/bitget/arena`).
5. Bitget asset logos remain a documented external-catalog deviation.
