Compile the following natural-language strategy into the strategy JSON object
described in the system prompt. Output only the JSON.

Strategy:
{{NATURAL_LANGUAGE_INTENT}}

Defaults to apply when the strategy is silent (use the safer value, never exceed):
- maxPositionPct: {{DEFAULT_MAX_POSITION_PCT}}
- perTradeRiskPct: {{DEFAULT_PER_TRADE_RISK_PCT}}
- maxConcurrentPositions: {{DEFAULT_MAX_CONCURRENT_POSITIONS}}
- maxDailyTrades: {{DEFAULT_MAX_DAILY_TRADES}}
- stopAtrMultiple: {{DEFAULT_STOP_ATR_MULTIPLE}}
- maxSlippageBps: {{DEFAULT_MAX_SLIPPAGE_BPS}}
- netEdgeMinBps: {{DEFAULT_NET_EDGE_MIN_BPS}}
- validationMode: {{DEFAULT_VALIDATION_MODE}}
