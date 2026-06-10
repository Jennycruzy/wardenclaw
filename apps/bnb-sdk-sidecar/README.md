# BNB AI Agent SDK sidecar

The official BNB AI Agent SDK (`bnbagent`) is **Python**, so this narrow sidecar
is the only Python in the project. It registers the agent's on-chain identity
(ERC-8004) and **owns no strategy, scoring, risk, or execution logic** — the
TypeScript core stays the single source of truth. The worker calls it through the
`registerAgentIdentity()` bridge in `@runeclaw/bnb-agent`.

## Setup

```bash
cd apps/bnb-sdk-sidecar
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Register the agent identity

```bash
export BNB_AGENT_WALLET_PASSWORD=...        # keystore password
export BNB_AGENT_PRIVATE_KEY=0x...          # first run only
export BNB_SDK_NETWORK=bsc                  # or bsc-testnet (gas-free) for rehearsal
python3 register_agent.py
# → {"ok": true, "agentId": "...", "transactionHash": "0x...", "network": "bsc"}
```

Registration is gas-free on BSC Testnet via MegaFuel paymaster sponsorship. On a
failure (missing package/password, on-chain error) it prints `{"ok": false,
"error": "..."}` and exits non-zero — it never fabricates an agent id or tx hash.
