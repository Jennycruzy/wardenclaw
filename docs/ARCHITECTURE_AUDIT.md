# WardenClaw — Architecture Audit & Gap Table

Status: living document. Records what the repo actually is, how the command-firewall
build maps onto it, what is preserved vs retired, and the decisions taken where the
build spec and the real code diverged. No requirement is silently dropped; every gap
is tracked below.

## 1. What WardenClaw is

A **command firewall for Bitget tokenized US stocks (xStocks)** with two
permissioning checkpoints:

```
strategy ─► [1] PLAYBOOK SHIELD ─► risk-bound mandates ─► [2] TRADE-PERMIT ENGINE ─► sim executor ─► signed, hash-chained Warden Card
              Certified/Restricted/Rejected                 Approve/Reduce/Delay/Hedge/Block/Close-only
```

Key line, true in code: **"No valid Warden Permit = no execution."** Playbook Shield
extends it one step earlier: **"No unsafe strategy even produces mandates."**

Everything is **paper / simulation only**. Verdicts are **deterministic** — the LLM
parses and classifies, it never decides risk. The system is **fail-closed**.

## 2. Architecture map (as built today)

### `packages/core` — deterministic engine (LLM-free risk)
| Module | Responsibility |
|---|---|
| `config.ts` | `RiskConfig` + `DEFAULT_RISK_CONFIG`, env loader (fail-loud numeric parse), `COMPETITION` constants |
| `types.ts` | `SignalMandate` static shape, `RejectCode`, proof-anchor types |
| `signalMandate.ts` | Zod runtime schema for `SignalMandate` (`parseMandate`/`safeParseMandate`) |
| `riskConstitution.ts` | `evaluateRiskGates` — the deterministic gate chain (spot-only/chain/router/approval/freshness/danger/concurrency/net-edge/shadow-fill) |
| `netEdgeGate.ts`, `frictionModel.ts`, `shadowFill.ts`, `stopCoherence.ts`, `drawdownGovernor.ts`, `edgeCalibration.ts`, `signalScorer.ts` | individual deterministic risk primitives |
| `eligibleTokens.ts` | allowlist assertion for trade legs |
| `auditLogger.ts` | **append-only JSONL + SHA-256 hash chain** (`hashEvent`, `buildEvent`, `verifyChain`, `AuditLogger`) |
| `replayEngine.ts` | reconstruct a mandate from its audit events + chain integrity check |
| `proofAnchors.ts` | external truth anchors merge/summary |
| `mandateStore.ts` | mandate persistence |
| `strategyCompiler.ts` | **`compileStrategy`: LLM proposes structure → every risk number clamped to hard caps**; manual fallback |
| `watchdog.ts` | deterministic open-position exit triggers (volatility stop, take-profit, sentiment-reversal, max-hold) |
| `backtester.ts` | historical replay/backtest |
| `llm/` | provider abstraction (`anthropic`, `openai`, `local`, `Disabled`), schemas, factory — **structured parsing only** |
| `prompts/` | system/user prompt text for compiler, news classifier, audit summary, reflection |

### `packages/bitget-adapter` — perception + paper venue
| Module | Responsibility |
|---|---|
| `universe.ts` | xStock universe (see §5 reconciliation), index proxies, BTC-correlated set |
| `marketData.ts` | Bitget public market data (live), fail-loud on missing data |
| `mcpClient.ts`, `mcpMarketData.ts`, `mcpSentiment.ts` | Bitget MCP server client + market/sentiment skills |
| `agentHub.ts` | Bitget Agent Hub source wrappers |
| `newsFeed.ts` | real news ingestion (earnings/shock timestamps) |
| `reactor.ts` | shock/cooldown reactor → `ReactorDecision` (the perception → entry-candidate layer) |
| `eventShockRanker.ts` | event-shock ranking |
| `indicators.ts` | ATR / volatility / confirmation indicators |
| `riskGate.ts` | `evaluatePaperRiskGate` — Bitget paper-side veto (feed-fresh, paper-fill source, reactor entry, index support, exposure) |
| `paperEngine.ts` | internal paper fills (labeled `internal_paper_engine`) |
| `demoExecutor.ts` | official Bitget Demo Trading executor (`paptrading:1`, real demo fills) |
| `executionAdapter.ts` | execution surface abstraction |
| `strategy.ts` | `compileBitgetStrategy` — wires the core compiler clamp to the reactor config (**this is the `StrategyCompilerAgent` clamp Playbook Shield feeds**) |
| `agents.ts`, `backtestReactor.ts` | agent stack + backtest harness |

### `apps/web` — `/bitget` dashboard
Next.js App Router. Pages: `/bitget` (dashboard), `/bitget/mandates[/id]`,
`/bitget/replay/[id]`, `/bitget/backtest`. API: `/api/bitget/command`,
`/api/bitget/live`. Components: charts, chips, live-console, shell, ui.

## 3. Preserve / repurpose / retire

**Preserve & repurpose**
- Reactor (`reactor.ts` + shock/cooldown/ranker) → the **perception layer** that
  feeds gate inputs (first-spike, cooldown, sentiment/technical agreement).
- Hash-chained audit (`auditLogger.ts`) + replay (`replayEngine.ts`) → extended into
  the **Warden Card / Strategy Safety Card** format (Phase 3 adds signing + expiry +
  single-use + market-state binding on top of the existing chain).
- Strategy compiler clamp (`strategyCompiler.ts` / `compileBitgetStrategy`) → the
  **output sink of Playbook Shield**: a Restricted verdict hands tightened caps to
  this clamp so the downstream pipeline actually runs under the lowered numbers.
- `watchdog.ts` exit triggers → reused by the **CLOSE-ONLY watcher** (Phase 6).
- `evaluatePaperRiskGate` / `evaluateRiskGates` → the deterministic gate machinery the
  **Trade-Permit Engine** (Phase 2) extends with xStock-native gates.

**Retire / supersede**
- `MSFTx` is retired from the *tradeable* universe to keep it at exactly five (still a
  valid Bitget symbol; see §5).
- BSC/BNB-specific framing in `riskConstitution.ts` (chain 56, pancakeswap, spot-only)
  is **not** the xStock firewall path; it stays for the BSC venue but the xStock
  Trade-Permit Engine is built on the Bitget-side gate machinery, not chain pinning.

## 4. Bitget toolchain

- **Agent Hub** wrappers live in `agentHub.ts`; market/exec endpoints used for live
  data and the official Demo Trading executor (`demoExecutor.ts`).
- **MCP server** (perception) wired via `mcpClient.ts` / `mcpMarketData.ts` /
  `mcpSentiment.ts`; registration command documented in the README.
- **Skill Hub** perception skills are declared as gate inputs in `docs/GATE_TABLE.md`
  (sentiment-analyst, news-briefing, technical-analysis, macro-analyst).
- Credentials from `BITGET_API_KEY` / `BITGET_API_SECRET` / `BITGET_API_PASSPHRASE`.
  Absent ⇒ everything runs offline/sim from fixtures; adapters fail loudly when
  misconfigured, never faked.

## 5. Asset-universe reconciliation (live-verified)

Queried `GET https://api.bitget.com/api/v2/spot/public/symbols` and per-symbol
`market/tickers` on **2026-06-19**. Findings:

- The `<TICKER>ON` series carries the equities: `AAPLONUSDT`, `NVDAONUSDT`,
  `TSLAONUSDT`, `MSFTONUSDT`, `QQQONUSDT`, `SPYONUSDT`, plus AMD/AMZN/GOOGL/META —
  all `online`. **No `MSTRON`/`COINON` exist.**
- The BTC-correlated names list **only** in the `R<TICKER>` series: `RMSTRUSDT`
  (rMSTR) and `RCOINUSDT` (rCOIN) are `online` and return live tickers
  (rMSTR ≈ $112.28, rCOIN ≈ $163.41 at check time).

**Decision — the tradeable universe is exactly five, ≥2 BTC-correlated:**

| Display | Bitget symbol | Underlying | BTC-correlated | Role |
|---|---|---|---|---|
| AAPLx | AAPLONUSDT | AAPL | no | equity / earnings |
| NVDAx | NVDAONUSDT | NVDA | no | equity / earnings anchor |
| TSLAx | TSLAONUSDT | TSLA | no | equity / earnings |
| MSTRx | RMSTRUSDT | MSTR | **yes** | HEDGE / CLOSE-ONLY |
| COINx | RCOINUSDT | COIN | **yes** | HEDGE / CLOSE-ONLY |

Index proxies (not counted in the five): `QQQx` (QQQONUSDT), `SPYx` (SPYONUSDT).
Substitution: `MSFTx` (MSFTONUSDT) retired from the tradeable set to honor the
"exactly five" rule; it remains a verified symbol and can be re-added if a BTC-
correlated name is dropped. No symbol is hard-coded without passing the live check —
the market-data client still fails loudly if any symbol returns no data.

Implemented in `packages/bitget-adapter/src/universe.ts` (`XSTOCK_UNIVERSE`,
`TRADEABLE_XSTOCKS`, `BTC_CORRELATED_XSTOCKS`, `isBtcCorrelated`) and the
`btcCorrelated` flag on `XStockSymbol` (`types.ts`).

## 6. Gap table — spec requirement → status

| # | Requirement | Status | Where |
|---|---|---|---|
| Universe | exactly 5 verified xStocks, ≥2 BTC-correlated | **done** | `universe.ts`, §5 |
| P1 | Playbook Shield: 3 verdicts (Certified/Restricted/Rejected) | **build** | new `src/gates/playbookShield` feeding `compileBitgetStrategy` |
| P1 | 5 static checks (leverage, martingale, daily-DD, cooldown, earnings/first-spike) | **build** | new |
| P1 | Strategy Safety Card (signed, chained, reuses card format) | **build** | extends `auditLogger` + Phase 3 signing |
| P2 | 6 trade verdicts (Approve/Reduce/Delay/Hedge/Block/Close-only) | **build** | new verdict engine over gate machinery |
| P2 | 10 deterministic gates incl. **xStock premium/discount** + BTC-correlation | **build/refactor** | extends `riskGate.ts` |
| P2 | fail-closed branches (stale/exception/expiry/tamper/unknown asset) | **partial→build** | `riskGate.ts` has stale/source; add the rest |
| P3 | Warden Permit: HMAC signature, expiry, single-use, price-drift binding, hash chain, canonical serialization | **build** (chain exists) | extends `auditLogger.ts` |
| P4 | Sim executor gateway (independent verify) + atomic two-leg HEDGE + `demo_bypass` | **build** | new executor wraps `demoExecutor`/`paperEngine` |
| P5 | Ghost sim (computed) + aggregate scorecard from real candles | **build** (backtester exists) | new scripts over `backtester.ts` |
| P6 | CLOSE-ONLY watcher (background monitor) | **build** | reuses `watchdog.ts` + gates |
| P7 | WardenClaw MCP server (audit_strategy/request_permit/verify_permit/…) | **build** | new |
| P8 | native evidence: structured logger (stdout+JSONL), studio-parity paper records | **build** (paper engine exists) | new logger + records |
| P9 | UI: verdict badges, Playbook panel, comparison, verification panel, fail-closed banner | **build** | extends `apps/web` replay-card UI |
| P10 | full test suite, docs (README/GATE_TABLE/PLAYBOOK_SHIELD), demo kit, COMPLIANCE_CHECKLIST | **build** | — |

## 7. Non-negotiables honored

Paper/sim only · deterministic verdicts · fail-closed · no narrated numbers (every
figure computed from real Bitget candles cached to fixtures) · Bitget-native tools &
data · 6 trade verdicts / 3 strategy verdicts / 5 assets · upgrade in place.
