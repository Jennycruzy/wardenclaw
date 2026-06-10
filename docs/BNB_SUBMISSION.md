# WARDENCLAW BSC — PnL-First Autonomous BSC Trading Agent

A self-custodial, spot-only BSC trading agent for **Track 1** of the BNB Hack:
AI Trading Agent Edition. It starts from **$40**, trades only the verified eligible
BEP-20 list **by contract address**, and optimizes for **total return under the
disqualification drawdown cap** with simulated transaction costs applied.

> CMC is its eyes, TWAK is its hands, the BNB SDK is its nervous system — it only
> trades when measured edge clears real friction plus the competition's simulated
> costs, and it spends a budgeted drawdown allowance on the catalysts that pay.

## The trade loop (every gate is deterministic)

```
CMC perception (real, attributed) →  deterministic score  →  calibrated expected move
  →  Return-vs-Drawdown governor (sizes against the binding drawdown layer)
  →  volatility-derived stop + size coherence  →  friction (real + simulated)  →  net-edge gate
  →  shadow-fill simulation  →  Risk Constitution  →  TWAK local policy  →  TWAK signs  →  BSC tx
```

The LLM is never in this chain. It may compile the natural-language constitution
into deterministic JSON, summarize CMC context, classify news, and draft the
strategy explanation — it can never choose a trade, size one, or bypass a gate.

## Spot-only, eligible-by-contract, never hold BNB

- **Spot swaps only on BSC mainnet (chainId 56), PancakeSwap router only.** No
  perps/leverage/margin — ever. Any such route is rejected `REJECT_NON_SPOT`.
- **Eligibility is keyed by exact BEP-20 contract address**, never by symbol
  (symbols like B, M, U, BRETT have multiple contracts). Both legs of every swap
  are asserted against the address-keyed allowlist.
- **Native BNB is gas only** and is never held as a ranked position; WBNB may
  appear only as an intermediate route hop (`REJECT_HELD_NATIVE_OR_WBNB`).

## Two signal families (§0.10)

- **Momentum/regime rotation (base):** rotate one position between the strongest
  liquid major and stables; park in eligible stables when no edge — parked stables
  stay ranked and in-scope.
- **Catalyst/breakout (offense):** short-horizon entries on CMC trending spikes /
  news shocks / volatility breakouts within the catalyst tier — the return engine,
  traded only through every gate with governor sizing.

## Micro-capital economics ($40 book)

Friction dominates a $40 book, and the competition charges a simulated cost too —
every trade pays twice. The **net-edge gate** blocks any trade whose calibrated
expected move doesn't clear real friction + simulated cost + margin. Stops are
**volatility-derived** and **position size is derived from the stop**; if the
resulting size makes friction exceed budget, the setup is skipped
(`REJECT_STOP_COHERENCE`) rather than forced. The **three-layer drawdown governor**
(DQ cap → internal window budget → daily limit) presses size on real edges when
the budget is healthy and shrinks toward zero as it thins.

## Trade-count discipline (verified: 1/day, 7/week)

The required daily trade IS a strategic trade whenever an edge exists. When no
edge exists and the day is closing, the sanctioned compliance trade is a
**stable↔stable Micro-Scout** (USDT→USDC, both eligible). A negative-edge
directional trade is never forced; if a scout would be unsafe, the agent holds and
alerts.

## Self-custody & TWAK (the sole executor)

TWAK is the only thing that signs. The backend produces Signal Mandates and never
moves funds; no private key touches the backend or a database. TWAK leans on three
surfaces — local signing, autonomous mode, and x402 — and enforces a **local
policy** at the signer (the refusal demo, below). See `docs/SPECIAL_PRIZES.md`.

## What is real vs. unverified (honest)

| Layer | Status |
|---|---|
| CMC perception | **Real** Pro API client (quotes/trending/fear-greed), fails loud without a key, per-tool attribution on every mandate. |
| Deterministic gates | **Real**, fully tested; the LLM cannot bypass them. |
| TWAK execution | Interface + local policy are **real and tested**; the SDK binding is **unverified** in this environment and fails loud until wired — never fakes a signature or tx hash. |
| BSC RPC / quotes | RPC failover + constant-product quote model are real; the live RPC quoter is wired in the worker. |
| Eligible tokens | Authoritative file is CMC-resolved (`build:eligible-tokens`); a curated set of **real canonical mainnet addresses** is the documented fallback. |
| Registration / x402 / live swap | Real flows behind TWAK; performed during the dress rehearsal — never simulated as done. |

## Run it

```bash
pnpm install
pnpm verify:integrations            # readiness report
pnpm build:eligible-tokens          # CMC-resolved contracts (needs CMC_API_KEY)
pnpm calibrate:edge                 # tune the score→move mapping on real history
pnpm backtest:bsc                   # economics on the $40 book
pnpm demo:twak-refusal              # TWAK refuses bad trades, live
pnpm run:bsc-agent                  # dry decision run on real CMC data (no signing)
pnpm rehearsal:checklist            # §0.12 gate → docs/PREFLIGHT.md
pnpm --filter @wardenclaw/web dev     # dashboards: /bsc, /bsc/proof, /bsc/ops
```

Live: configure TWAK + RPC + alerts, pass the rehearsal, then run under pm2
(`pm2 start ops/pm2.config.cjs`). See `docs/OPERATIONS.md` and `docs/PREFLIGHT.md`.

## The four open items (§0.1b)

Exact DQ %, the simulated-cost model, whether WBNB/BNB count in-scope, and the
149-vs-enumerated count are the only unverified values. Conservative defaults are
authoritative and nothing waits on them; they appear as warnings on `/bsc/rules`.
If organizer answers arrive, a config value is the only change needed.
