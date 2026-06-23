/**
 * Refresh real-candle backtest reports for the complete verified xStock universe.
 *
 * Intended for the production systemd timer. Each symbol runs through the same
 * fail-closed backtest command used manually. A failed symbol is reported and
 * the batch exits non-zero; synthetic data is never substituted.
 */

import "dotenv/config"; // so spawned backtests inherit the live agent's thresholds
import { spawnSync } from "node:child_process";
import { TRADEABLE_XSTOCKS } from "@wardenclaw/bitget-adapter";

let failed = 0;

for (const asset of TRADEABLE_XSTOCKS) {
  console.log(`[backtest-refresh] starting ${asset.display} (${asset.bitgetSymbol})`);
  const result = spawnSync(
    "pnpm",
    ["backtest:bitget", "--", asset.display],
    { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    failed += 1;
    console.error(`[backtest-refresh] FAILED ${asset.display} (exit ${result.status ?? "unknown"})`);
  } else {
    console.log(`[backtest-refresh] completed ${asset.display}`);
  }
}

if (failed > 0) {
  throw new Error(`${failed}/${TRADEABLE_XSTOCKS.length} real-candle backtests failed`);
}

console.log(`[backtest-refresh] complete: ${TRADEABLE_XSTOCKS.length} verified assets`);
