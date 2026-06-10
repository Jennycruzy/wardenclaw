# Micro-Capital Economics

A ~$40 spot-only book lives or dies on friction. The competition also charges a
simulated transaction cost against scored return, so every trade pays twice. The
economics engine is therefore a first-class part of the risk system, not an
afterthought.

## Friction model (`frictionModel.ts`)

Round-trip friction in basis points of notional:

```
friction_bps =
    (gas_in_usd + gas_out_usd) / notional_usd * 10000   # gas, both legs
  + expected_slippage_bps * 2                            # router quote vs mid, both legs
  + lp_fee_bps * 2                                       # PancakeSwap pool fee, both legs
  + scoring_sim_cost_bps * 2                             # competition's simulated cost, both legs
  + safety_buffer_bps
```

`realFrictionBps` excludes the simulated cost; `frictionBps` includes it. Gas USD
comes from a live BSC gas estimate × BNB price (CMC). Slippage comes from the
actual router quote at the intended size — never a guess.

## Net-edge gate (`netEdgeGate.ts`)

```
expected_move_bps >= friction_bps + NET_EDGE_MIN_BPS
```

Applies to entries and exits. Forced safety exits bypass it. `expected_move_bps`
comes from the calibrated score→move mapping, never from the LLM. A failure logs
`REJECT_NET_EDGE` with the numbers.

## Volatility-derived stops + size coherence (`stopCoherence.ts`)

Stops come from the pair's recent noise band, never a fixed percentage. Size is
then derived from the stop:

```
stop_distance_pct  = STOP_ATR_MULTIPLE * recent_ATR_pct
risk_usd           = (PER_TRADE_RISK_PCT / 100) * portfolio_usd
position_size_usd  = risk_usd / stop_distance_pct
position_size_usd  = min(position_size_usd, MAX_POSITION_PCT% * deployable, governor cap)
```

If the volatility stop forces a size so small that friction exceeds
`FRICTION_BUDGET_BPS`, the setup is not tradeable at this book size — it logs
`REJECT_STOP_COHERENCE` rather than tightening the stop to force a fit.

Worked example (defaults): portfolio $40, `PER_TRADE_RISK_PCT=3`,
`STOP_ATR_MULTIPLE=1.5`, recent ATR 4%. Stop distance = 1.5 × 4% = 6%. Risk =
$1.20. Size = $1.20 / 0.06 = **$20** (within the 70% cap of ~$28). At $20 notional
with ~$0.04 round-trip gas, friction is well inside budget, so the trade is
coherent.

## Three-layer drawdown governor (`drawdownGovernor.ts`)

```
COMPETITION_DQ_DRAWDOWN_PCT = 30   # the disqualifier; never to be touched
INTERNAL_WINDOW_DRAWDOWN_PCT = 15  # the offense's actual risk budget
MAX_DAILY_DRAWDOWN_PCT = 6         # internal daily limit
SOFT_DRAWDOWN_PCT = 4              # governor begins de-risking
```

The governor budgets against whichever layer has the least remaining headroom:

```
base_fraction      = KELLY_FRACTION * edge_estimate     # quarter-Kelly, edge from calibration
drawdown_scaled    = max_position_fraction * (remaining / cap)   # of the binding layer
size_fraction      = min(base_fraction, drawdown_scaled, max_position_fraction)
```

Size presses up when realized edge is real and the budget is healthy, and shrinks
toward zero as the binding budget thins. It never exceeds configured caps and
never overrides the net-edge gate. A 15% window budget is an intentional risk
allocation — an agent that risks 2% all week cannot place in a total-return
ranking.

## Shadow-fill guard (`shadowFill.ts`)

Before signing, simulate the exact swap against current chain state and compare
`simulated_out` to the `expected_out` the decision used. Adverse deviation beyond
`SHADOW_FILL_TOLERANCE_BPS` aborts with `REJECT_SHADOW_FILL` (thin liquidity, a
moved price, or sandwich risk).

## Micro-Scout

The minimum-trade rule (1/day, 7/week) is satisfied with a strategic trade when an
edge exists. When none does, the sanctioned compliance trade is a stable↔stable
swap (default USDT→USDC, both eligible) at `MICRO_SCOUT_USD` notional. It is exempt
from the net-edge gate because its purpose is rule compliance, not edge, but it
still respects eligibility and slippage caps and is skipped if conditions are
unsafe.

## Hourly snapshots (`hourlySnapshot.ts`)

Mirrors the organizers' hourly scoring: a per-hour return series with the $1 floor
applied (an hour starting at or below the floor scores 0%), plus whole-window
drawdown and total return.
