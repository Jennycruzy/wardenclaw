# Self-Audit

Status: shared core + Bitget reactor engine complete. The Bitget judge dashboard
and the full BNB-live build are not yet built; their rows are marked
`pending(...)` — listed, not silently dropped.

## Coverage traceability

| Spec section | Requirement | Status | Evidence |
|---|---|---|---|
| 0 | No fake data; fail loudly; documented env; testable core | implemented | `scripts/*` fail loud; `.env.example`; `packages/core` tests |
| 0.1 | Verified competition rules captured | implemented | `competitionRules.ts`, `docs/COMPETITION_RULES.md`, `verify:competition-rules` |
| 0.1a | Address-keyed eligible allowlist; BNB/WBNB never held | implemented | `eligibleTokens.ts`, `test/eligibility.test.ts` |
| 0.1b | Four open items surfaced as warnings, conservative defaults authoritative | implemented | `competitionRules.ts` warnings; `config.ts` defaults |
| 0.1c | TWAK prize rubric mapped | pending(bnb) | `docs/SPECIAL_PRIZES.md` not yet written |
| 0.2 | Deterministic configurable risk gates | implemented | `riskConstitution.ts`, `test/riskGates.test.ts` |
| 0.3 | BSC chain + spot-router pinning | implemented (core) | `riskConstitution.ts` (chainId 56, router, spot-only); TWAK adapter pending(bnb) |
| 0.4 | ERC-20 approval hygiene | implemented (core) | `riskConstitution.ts` approval gate, `test/riskGates.test.ts`; on-chain revoke pending(bnb) |
| 0.5 | LLM model policy + provider abstraction | implemented | `llm/*`, `test/llm.test.ts`, `docs/LLM_POLICY.md` |
| 0.6 | x402 payment policy | pending(bnb) | trade-loop integration not yet built |
| 0.7 | Audit truth policy (integrity vs anchors) | implemented | `proofAnchors.ts`, `auditLogger.ts`, `test/coreModules.test.ts` |
| 0.8 | Micro-capital friction + net-edge + sizer | implemented | `frictionModel.ts`, `netEdgeGate.ts`, `test/economics.test.ts` |
| 0.8a | Volatility stops + size coherence | implemented | `stopCoherence.ts`, `test/economics.test.ts` |
| 0.9 | Three-layer governor + shadow-fill + hourly snapshot | implemented | `drawdownGovernor.ts`, `shadowFill.ts`, `hourlySnapshot.ts`, tests |
| 0.10 | Offense doctrine + calibration | implemented (core) | `edgeCalibration.ts`, `scripts/calibrate-edge.ts`; live data feed pending(bnb) |
| 0.11 | Ops resilience (recovery, RPC failover, alerts, kill-switch) | partial | `recovery.ts` + `test/coreModules.test.ts`; failover/alerts/kill-switch pending(bnb worker/api) |
| 0.12 | Dress-rehearsal gate | pending(bnb) | `rehearsal:checklist` not yet built |
| 0.13 | Scope tiering | implemented | this file orders MUST→SHOULD→NICE |
| 0.14 | Clean modern UI | pending(bitget/bnb) | no UI yet |
| 1 | Signal Mandate primitive | implemented | `types.ts`, `signalMandate.ts`, `test/mandate.test.ts` |
| 2 | Submission split | partial | Bitget engine in `packages/bitget-adapter` (Bitget-only, no CMC/TWAK/BNB/BSC); BNB build pending |
| 3.1 | Strategy compiler | implemented | `strategyCompiler.ts`, `test/strategyCompiler.test.ts` |
| 3.2 | Signal Mandate object/schema | implemented | `signalMandate.ts`, `test/mandate.test.ts` |
| 3.3 | Deterministic signal scorer | implemented | `signalScorer.ts`, `test/scorer.test.ts` |
| 3.4 | Risk constitution | implemented | `riskConstitution.ts`, `test/riskGates.test.ts` |
| 3.5 | Trade-count vs survival precedence | implemented (core) | micro-scout exemption + survival gating in `riskConstitution.ts`; scheduler pending(bnb) |
| 3.6 | Watchdog | implemented | `watchdog.ts`, `test/coreModules.test.ts` |
| 3.7 | Audit logger + hash chain | implemented | `auditLogger.ts`, `test/audit.test.ts` |
| 3.8 | Backtester / paper engine | implemented | `backtester.ts`, `test/backtester.test.ts` |
| 3.9 | LLM runtime layer + bypass tests | implemented | `llm/*`, `test/strategyCompiler.test.ts`, `test/llm.test.ts` |
| 4.1–4.6 | Bitget reactor: xStock universe, real market data, paper engine, agent stack, shock/cooldown strategy, LLM usage bounds | implemented | `packages/bitget-adapter/*`, 38 tests |
| 4.3 | Execution-mode priority (official demo only if verified, else internal paper, labeled) | implemented | `executionAdapter.ts`, `test/executionAndRanker.test.ts` |
| 4.7 | Bitget judge dashboard | pending(bitget-ui) | engine + audit/replay data produced; Next.js pages not yet built |
| 4.9 | Bitget paper demo on real inputs, net-edge as quality filter | implemented | `agents.ts`, `scripts/run-bitget-paper.ts` |
| 5.x | BNB live build | pending(bnb) | — |
| 6 | Tech stack / monorepo layout | partial | core + bitget-adapter packages in place; apps (web/api/worker) pending |
| 7 | Environment variables documented | implemented | `.env.example`, `config.ts` loader |
| 8 | Tests | partial | core (82) + Bitget (38) green; BNB/ops integration tests pending |
| 9 | Deliverables | partial | shared-core + Bitget engine done; Bitget UI + BNB deliverables pending |
| 10 | Demo scripts + preflight | pending(bitget/bnb) | — |
| 11 | README + docs | partial | README, COMPETITION_RULES, ECONOMICS, LLM_POLICY, BITGET_SUBMISSION, SELF_AUDIT written; rest pending |
| 12 | Special prize doc | pending(bnb) | — |
| 13 | Final quality bar | partial | core + Bitget engine meet bar; UI + BNB pending |
| 14 | Self-audit protocol | implemented | this document |

## Honesty audit (shared core)

1. **Any fake data presented as real?** No. Every module is pure logic or fails
   loudly. `build-eligible-tokens` and `calibrate-edge` refuse to run without real
   inputs rather than fabricating contracts or samples.
2. **Any path where LLM output reaches execution without passing every gate?** No.
   There is no execution path yet; the strategy compiler clamps risk to caps and
   the gate chain takes plain numbers, not LLM flags.
3. **Any way a tx reaches TWAK that is not a chain-56 spot swap between eligible
   contracts via an allowlisted router?** Not in core: the risk constitution
   rejects non-spot, wrong-chain, off-router, ineligible-contract candidates. The
   TWAK adapter itself is a BNB-live item.
4. **Any path where a private key touches the backend/DB?** No. No signing code
   exists yet; the design routes all signing through TWAK (BNB-live).
5. **Can the agent duplicate a trade after a crash-restart?** The reconciliation
   logic resolves submitted txs from chain state and flags duplicate nonces;
   proven by `test/coreModules.test.ts`. The full worker wiring is BNB-live.
6. **Is the allowlist keyed by contract address everywhere?** Yes — `eligibleTokens.ts`
   keys by lowercased contract address; no symbol-keyed eligibility check exists.
7. **Can the agent hold BNB or WBNB as a position?** No — `assertLegsEligible`
   rejects native/WBNB legs with `REJECT_HELD_NATIVE_OR_WBNB`.
8. **Are the four open items surfaced as warnings (not silent defaults)?** Yes —
   `verify:competition-rules` prints them as warnings and the rules registry tags
   them `needs-organizer-confirmation`.
9. **Was every integration verified from official docs, failing loudly otherwise?**
   No external integration is wired yet; the provider/script stubs that touch
   external services fail loudly without keys/inputs. Real doc verification happens
   when the adapters are built.
10. **Is the calibration real or a placeholder?** The mapping and report builder
    are real and tested; they consume real samples supplied by the script, which
    refuses to fabricate them. The historical data feed comes with the BNB-live build.
11. **Would the rehearsal checklist catch a broken TWAK pipeline?** Not yet — the
    rehearsal gate is a BNB-live deliverable.
12. **Would a replayed mandate be fully backed by anchors or labeled paper?** Yes
    for the implemented replay engine: it surfaces external anchors and marks
    paper-only mandates; `test/replay.test.ts`.

## Honesty audit (Bitget reactor engine)

1. **Any fake data presented as real?** No. Market data comes from the real
   Bitget public v2 API; the client throws on an error code, empty payload, or
   bad HTTP rather than inventing a price. Paper fills are labeled
   `internal_paper_engine` / `simulated: true` and are never called exchange
   fills. Agent Hub news/sentiment is fail-loud (`UnverifiedAgentHub`); the
   backtest's synthetic fallback is explicitly labeled `synthetic_*` in its report.
2. **LLM reaching execution without gates?** No. The reactor and paper risk gate
   are pure deterministic functions; the LLM only compiles strategy / classifies
   real news and cannot enter a trade.
3. **Official Bitget demo faked?** No. `OfficialBitgetDemoExecutor` throws
   "not implemented (endpoints unverified)" — it never silently fabricates a fill.
   `selectExecutionMode` only returns `official_bitget_demo` when explicitly told
   it is verified.
4. **xPerps?** Disabled module; `assertXPerpsEnabled` refuses to run.
5. **xStock symbols?** Best-effort and marked NEEDS VERIFICATION; an unresolved
   symbol fails loudly and is skipped, never priced. Documented in
   `BITGET_SUBMISSION.md` and `universe.ts`.
6. **Audit integrity?** Every cycle writes hash-chained events; `test/agents.test.ts`
   asserts `verifyChain === -1` end to end, and mandates validate via `parseMandate`.

Known gap (not hidden): the Bitget judge **dashboard** (§4.7, §0.14 MUST) is not
yet built — only the engine, audit, and replay data it will render.

## Gate

`pnpm install && pnpm typecheck && pnpm lint && pnpm test` is green: **120 tests**
(82 core + 38 Bitget). No silent gaps; every unbuilt item is listed as pending.
