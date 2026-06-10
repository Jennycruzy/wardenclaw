# Setup

One install, then per-submission commands. Written for someone who does not read code.

## Prerequisites

- Node ≥ 20, `pnpm` (the repo pins a version via `packageManager`).
- For live BSC: a Trust Wallet Agent Kit wallet, a CMC API key, BSC RPC URLs.

## Install

```bash
pnpm install
cp .env.example .env   # then fill in keys you have; everything is documented
```

Every variable in `.env.example` is documented inline. Nothing is required just to
run tests or the dashboards with empty state.

## Verify the build

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm verify:competition-rules
pnpm verify:integrations
```

## Bitget submission (paper, real market data)

```bash
pnpm backtest:bitget                # report → data/backtests/ (shown on the dashboard)
pnpm run:bitget-paper               # paper-trade real Bitget public data
pnpm --filter @wardenclaw/web dev     # http://localhost:3000/bitget
```

Execution is always labeled (`internal_paper_engine`); fills are simulated on real
prices, never presented as exchange fills.

## BNB / BSC submission (spot-only, $40)

```bash
pnpm build:eligible-tokens          # CMC-resolved contracts (needs CMC_API_KEY)
pnpm calibrate:edge                 # tune score→expected-move on real history
pnpm backtest:bsc                   # economics on the $40 book
pnpm demo:twak-refusal              # TWAK refuses bad trades (no funds move)
pnpm run:bsc-agent                  # dry decision run on real CMC data (no signing)
pnpm --filter @wardenclaw/web dev     # http://localhost:3000/bsc and /bsc/proof
```

### Going live (during the competition week)

1. Configure `CMC_API_KEY`, `TWAK_CONFIG_PATH`, `BSC_RPC_URLS`, `ALERT_WEBHOOK_URL`,
   `KILL_SWITCH_TOKEN`.
2. `pnpm verify:integrations -- --live` (must pass).
3. Register: `twak compete register` → record the tx as `REGISTRATION_TX_HASH`.
4. `pnpm rehearsal:checklist` and complete the manual live steps (§0.12).
5. Fund the wallet with eligible stables + native BNB for gas.
6. `pm2 start ops/pm2.config.cjs` (see `docs/OPERATIONS.md`).

Live mode refuses to start unless the rehearsal gate passed (override only after
you have manually confirmed the live steps: `REHEARSAL_OVERRIDE=true`).

## LLM (optional)

Set `LLM_PROVIDER` (or just an `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`). With no key,
the system runs in deterministic/manual mode — trading still works; the dashboards
show "LLM disabled". The LLM never makes a trade decision (`docs/LLM_POLICY.md`).

## Where things are

- Dashboards: `apps/web` (`/bitget`, `/bsc`, `/bsc/proof`, `/bsc/ops`).
- Control API: `apps/api` (health + kill-switch). Worker: `apps/worker`.
- Engine: `packages/core` + `packages/{bitget,cmc,bsc,twak}-adapter`, `packages/bnb-agent`.
- Audit/replay data: `data/audit/`. Reports: `data/backtests/`, `data/calibration/`.
