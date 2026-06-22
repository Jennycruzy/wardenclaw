# Bitget Demo Key — provisioning & reality check

**Status (2026-06-22): demo API key installed and verified** on both the dev
workspace and the VPS checkout (`/root/wardenbitget`). The three credentials live
in `.env` (gitignored) as `BITGET_API_KEY` / `BITGET_API_SECRET` /
`BITGET_API_PASSPHRASE`. The VPS `.env` was backed up before the edit, following
the existing `.env.bak.<timestamp>` convention, and `claw-console` was restarted
cleanly afterward.

## What the key verifies

`pnpm verify:bitget-demo-key` (`scripts/verify-bitget-demo-key.ts`) reports:

```
demo environment (paptrading: 1): ok
→ key works in Demo Trading mode.
```

So the credentials authenticate against Bitget's Demo Trading environment and the
official Agent Hub MCP server (`BITGET_AGENT_HUB_MCP=true`) supplies **real**
market-data perception.

## Why execution still stays on the internal paper engine

`BITGET_EXECUTION_MODE` remains `internal_paper_engine` **by design** — installing
the key does not (and must not) flip it to live demo execution:

- **Bitget Demo Trading is futures-only** (support article 12560603790031; live
  tests 2026-06-11). Spot endpoints return `40099 "exchange environment is
  incorrect"` under `paptrading`.
- The **xStock universe is spot** (`AAPLx`, `NVDAx`, `TSLAx`, `MSTRx`, `COINx`).
- Therefore **there is no live demo-fill path for the xStocks.** The key buys a
  clean auth check plus real Agent Hub market data; fills remain simulated on real
  prices, honestly labeled `internal_paper_engine`, never presented as exchange
  fills.

Re-test with `pnpm verify:bitget-demo-key` if Bitget ever ships spot demo trading;
only then would switching the execution mode be meaningful.
