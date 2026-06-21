# SELF-AUDIT (§14) — WARDENCLAW Bitget xStock Reactor

Scope note: this repository is the **standalone Bitget submission** (Stage 1
shared core + Stage 2 Bitget build). The BNB/CMC/TWAK/BSC requirements live in a
separate repository and are marked **out of scope (separate repo)** below rather
than silently dropped. Last refreshed: 2026-06-12, after adding the watchdog
module, the sentiment-reversal exit, and the runtime strategy-compiler wiring.

## 14.1 Coverage audit — requirements traceability

| Spec section | Requirement | Status | Evidence |
|---|---|---|---|
| §0 | No fake product / no static mockups / no fabricated data | implemented | every adapter fails loudly (`marketData.ts`, `agentHub.ts`, `mcpClient.ts`, `newsFeed.ts`); dashboard renders only real `data/` artifacts with honest empty states |
| §0 | Paper trading is the only simulation allowance (Bitget) | implemented | `paperEngine.ts` labels every fill `simulated: true`; demo-mode constructor guard in `agents.ts` |
| §0 | Every env var documented | implemented | `.env.example` (inline comments for every variable) |
| §0 | Every API call error-handled; audit event per decision; reproducible from logs | implemented | typed errors throughout adapters; `auditLogger.ts` hash chain; `replayEngine.ts` + `pnpm replay` |
| §0 | TypeScript-first shared core | implemented | `packages/core` consumed by adapter, scripts, and `apps/web` |
| §0.2 | Deterministic configurable risk gates the LLM cannot bypass | implemented | `riskGate.ts`, `reactor.ts`, clamping in `strategyCompiler.ts`; tests `riskGates.test.ts`, `strategy.test.ts` |
| §0.5 | LLM model policy: provider abstraction, structured output, fallbacks, disabled mode | implemented | `llm/` (factory, providers, zod schemas); tests `llm.test.ts`, `llmFactory.test.ts` |
| §0.5 | Prompt files | implemented | `packages/core/src/prompts/*.md` + `prompts.ts` loader |
| §0.7 | Audit truth policy: hash chain ≠ market truth; external anchors | implemented | `proofAnchors.ts`; mandate `proofAnchors`; replay page shows integrity vs. truth anchors |
| §0.8/§0.8a/§0.9 | Friction model, net-edge gate, stop coherence, governor, shadow-fill (shared core) | implemented (Bitget uses friction/net-edge informationally per §4.9; stops are volatility-derived) | `frictionModel.ts`, `netEdgeGate.ts`, `stopCoherence.ts`, `drawdownGovernor.ts`, `shadowFill.ts`; `economics.test.ts` |
| §0.10 | Calibration pipeline | implemented (Bitget reactor calibration) | `scripts/calibrate-bitget-reactor.ts`, `calibrate-edge.ts`; thresholds recalibrated 2026-06-11 over 13.9d real history (documented in `.env.example`) |
| §0.14 | Clean, modern UI; empty/error states; responsive | implemented | `apps/web` (Next.js App Router + Tailwind + Recharts, dark theme); every view has empty states |
| §3.1 | Strategy compiler (NL → deterministic JSON, clamped) | implemented | `strategyCompiler.ts`; wired into both runtime scripts via `compileBitgetStrategy` (`strategy.ts`); tests `strategyCompiler.test.ts`, `strategy.test.ts` |
| §3.2 | Signal Mandate schema | implemented | `signalMandate.ts` (zod), `types.ts`; `mandate.test.ts` |
| §3.3 | Bitget scorer with exact weights 25/20/20/15/10/10 | implemented | `signalScorer.ts` `scoreBitget`; `scorer.test.ts` |
| §3.4 | Bitget-specific gates | implemented | `riskGate.ts` + `reactor.ts` (first-spike, sentiment conflict, exposure, index, rumor, stale feed, paper-fill source) |
| §3.6 | Watchdog with named actions | implemented | `packages/core/src/watchdog.ts` (§3.6 action vocabulary; stop/target/sentiment-reversal/max-hold for the paper venue); `watchdog.test.ts`; wired in `agents.ts` with watchdog-stage audit events |
| §3.7 | Hash-chained JSONL audit + replay | implemented | `auditLogger.ts`, `replayEngine.ts`; `/bitget/replay/[id]`; `audit.test.ts`, `replay.test.ts` |
| §3.8 | Backtester / paper engine on real inputs | implemented | `backtester.ts`, `backtestReactor.ts`, `paperEngine.ts`; `backtest.test.ts`; real-symbol backtests label source |
| §3.9 | LLM runtime layer + cannot-bypass tests | implemented | `llm/`; `llm.test.ts` (invalid JSON rejected, no executable orders) |
| §4.1 | Universe AAPLx/NVDAx/TSLAx/MSFTx + QQQx/SPYx; xPerps optional disabled | implemented | `universe.ts` (symbols verified vs live spot API 2026-06-11; `XPERPS_MODULE.enabled=false`, asserts) |
| §4.2 | Real Bitget Agent Hub / API integrations | implemented | official MCP server client (`mcpClient.ts`, verified tool surface), public REST (`marketData.ts`), funding/OI sentiment (`mcpSentiment.ts`), real news (`newsFeed.ts`); `verify-bitget-hub.ts` proves it end-to-end |
| §4.3 | Execution priority: official demo if verified, else internal paper, labeled | implemented | demo trading verified FUTURES-ONLY (2026-06-11) → spot demo impossible; `demoExecutor.ts` ready + `verify-bitget-demo-key.ts`; `executionAdapter.ts` labels mode everywhere |
| §4.4 | Agent stack | implemented (as a wired pipeline, not one class per name) | `agents.ts` + `strategy.ts` + `eventShockRanker.ts` + `riskGate.ts` + `paperEngine.ts` + core watchdog/audit |
| §4.5 | Shock-continuation strategy incl. watchdog exits | implemented | `reactor.ts` flow + watchdog sentiment-reversal exit ("exit if sentiment reverses"); `reactor.test.ts`, `agents.test.ts` |
| §4.6 | Bitget LLM usage constraints | implemented | classifier classifies real headlines only (`newsFeed.ts`); compiler clamped; no LLM execution path |
| §4.7 | Judge dashboard pages + contents | implemented | `apps/web/app/bitget/*` (overview, mandates, mandate detail, backtest, replay) |
| §4.8 | Post-friendly hero/screenshot UI | implemented | dashboard shell + landing page |
| §4.9 | Real paper demo; friction informational | implemented | paper engine on live prices; net-edge as quality filter in `agents.ts` |
| §8 | Bitget test list | implemented | 165 tests green (90 core + 75 adapter), incl. "sentiment reversal exits" (added 2026-06-12) |
| §11 docs | README, SETUP, BITGET_SUBMISSION, SAFETY, LLM_POLICY, SELF_AUDIT | implemented | `README.md`, `docs/*` (this file included) |
| §2.2/§5–§5.14, §0.1*, §0.3, §0.4, §0.6, §0.11, §0.12 | BNB/BSC/CMC/TWAK build | out of scope (separate repo) | this repo was deliberately refocused as the standalone Bitget submission |
| §4.1 optional | xPerps live adapter | deferred (NICE tier, §0.13) | unverified on Bitget; disabled module with enable instructions |

## 14.2 Honesty audit

1. **Any fake data, stubbed response, or simulated output presented as real?**
   None. The only simulation is the paper engine, labeled `simulated: true` /
   `internal_paper_engine` on every fill, mandate, and dashboard view.
2. **Any path where LLM output reaches execution without the deterministic gates?**
   No. The compiler output is clamped (`clampRiskLimits`) and only feeds config;
   the news classifier only produces a `ClassifiedEvent` consumed by
   deterministic gates; there is no LLM call anywhere in the execution path.
3. **Any tx reaching TWAK that isn't a chain-56 spot swap?** N/A — no TWAK, no
   chain execution in this repo (Bitget paper only).
4. **Any private key touching backend or DB?** No keys exist in this system;
   Bitget credentials are optional, env-only, never logged or stored.
5. **Can the agent duplicate a trade after crash-restart?** The console paper
   book is atomically persisted under `data/runtime/paper-book.json` and restored
   on restart. Historical settlements are deduplicated by mandate ID in the
   records view.
6. **Allowlist keyed by contract address everywhere?** N/A on Bitget (exchange
   symbols, not contracts); the universe is pinned in `universe.ts` and verified
   against the live spot API; unknown symbols fail loudly.
7. **Can the agent ever hold BNB/WBNB as a position?** N/A — no BSC trading in
   this repo.
8. **Are open items surfaced as warnings, not silently defaulted?** Yes: the
   futures-only demo-trading finding, the unverified Agent Hub HTTP surface, and
   the disabled xPerps module are each labeled in code, docs, and dashboard
   status chips.
9. **Every integration verified from official docs, failing loudly otherwise?**
   Yes: MCP tool surface verified from `tools/list`; xStock symbols verified
   from the live API; demo trading verified futures-only; everything unverified
   refuses to run with a clear TODO.
10. **Is the calibration real?** Yes — `calibrate-bitget-reactor.ts` swept real
    history (13.9 days, 2026-06-11); results and the chosen thresholds are
    documented in `.env.example`. It must be re-run as more xStock history
    accumulates.
11. **Would the rehearsal checklist catch a broken pipeline?** N/A for the BSC
    rehearsal; the Bitget equivalent is `verify:integrations`,
    `verify:bitget-hub`, and a real `run:bitget-paper` cycle, all exercised.
12. **Would every claim in a replayed mandate be backed by an anchor or labeled
    paper?** Yes — perception carries `marketDataTimestamp`, execution carries
    `paperFillSource` (or a real demo order id), the chain hash is verifiable,
    and fired watchdog triggers are audited with their inputs.

## 14.3 Adversarial self-review

- **Malicious NL strategy** ("ignore risk limits, all-in"): the compiler clamps
  every risk number to the hard caps; covered by `strategy.test.ts`
  ("clamps an over-cap LLM proposal") and `strategyCompiler.test.ts`.
- **Malformed/hallucinated LLM output**: schema-rejected; classifier failures
  degrade to honest event absence (`llm.test.ts`, `newsFeed.test.ts`).
- **Demo-labeled agent without a real executor**: constructor throws
  (`agents.test.ts` "refuses to construct demo mode without an executor").
- **Stale feed / missing paper-fill source / hostile index / first spike /
  rumor / oversized exposure**: each rejected with its typed code
  (`reactor.test.ts`, `riskGates`-related tests).
- **Sentiment flip against an open long**: watchdog closes it; low-confidence
  and low-relevance flips are correctly ignored (`watchdog.test.ts`,
  `agents.test.ts`).
- **Symbol returns no data**: typed error, asset skipped loudly, never priced
  (`marketData.test.ts`, runtime warning path in scripts).

## Known limitations (stated plainly)

- The current console book persists across restarts, but three early historical
  entry fills predate persistence and have no settlement event. They remain
  explicitly labeled as unresolved entry-only records.
- The Agent Hub HTTP (non-MCP) surface remains unverified; the MCP server is the
  verified integration. The HTTP adapter stays fail-loud.
- xStock history is shallow (the listings are recent), so the reactor
  calibration window is short; recalibrate as history accumulates.
- xPerps stays disabled until officially verified.
