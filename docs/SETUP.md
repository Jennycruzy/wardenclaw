# Setup

WARDENCLAW — Bitget xStock Reactor. Paper trading on **real** Bitget public market data.
Written for someone who does not read code.

## Prerequisites

- Node ≥ 20, `pnpm` (the repo pins a version via `packageManager`).
- Optional: an LLM key (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`) for news-sentiment classification,
  strategy compilation, and audit summaries. The agent runs fully without one (deterministic mode).
- Optional: Bitget API credentials — only needed to re-test Demo Trading with
  `pnpm verify:bitget-demo-key`. Spot xStocks run on the internal paper engine, which needs no key.
  A demo key is currently provisioned & verified — see `docs/BITGET_DEMO_KEY.md` for what it does
  and does not enable (execution stays `internal_paper_engine` because Bitget demo is futures-only).

## Install

```bash
pnpm install
cp .env.example .env   # then fill in keys you have; everything is documented
```

Every variable in `.env.example` is documented inline. Nothing is required just to run tests or the
dashboard with empty state.

## Verify the build

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm verify:integrations            # readiness report (honest about what's wired)
pnpm verify:llm                     # prove the LLM provider answers (only if configured)
pnpm verify:bitget-hub              # prove the Bitget Agent Hub MCP integration end-to-end
```

## Run the reactor (paper, real market data)

```bash
pnpm backtest:bitget -- NVDAx      # resolves to verified NVDAONUSDT; real candles only
pnpm backtest:all                  # refresh all five verified assets
pnpm calibrate:reactor              # calibrate shock thresholds against real history
pnpm run:bitget-paper               # paper-trade real Bitget public data
pnpm console:bitget                 # interactive live console
pnpm --filter @wardenclaw/web dev   # dashboard → http://localhost:3000/bitget
```

Execution is always labeled (`internal_paper_engine`); fills are simulated on real prices, never
presented as exchange fills.

## Automated backtest refresh on the VPS

```bash
cp ops/warden-backtests.service ops/warden-backtests.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now warden-backtests.timer
systemctl list-timers warden-backtests.timer
```

The timer runs hourly and writes new reports under `data/backtests/`. It uses only
real Bitget candles and exits non-zero on retrieval failures.

## LLM (optional)

Set `LLM_PROVIDER` (or just an `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`). With no key, the system runs
in deterministic/manual mode — trading still works; the dashboard shows "LLM disabled". The LLM
never makes a trade decision (`docs/LLM_POLICY.md`).

## Where things are

- Dashboard: `apps/web` (`/bitget`, `/bitget/mandates`, `/bitget/backtest`).
- Engine: `packages/core` (deterministic gates, mandates, audit, replay, calibration) +
  `packages/bitget-adapter` (market data, reactor, paper engine, ranker, Agent Hub MCP, backtest).
- Scripts: `scripts/` (run, backtest, calibrate, replay, verify).
- Artifacts: `data/` (audit JSONL, backtest reports, calibration) — gitignored, generated at runtime.
