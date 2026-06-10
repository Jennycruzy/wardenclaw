#!/usr/bin/env python3
"""WARDENCLAW — BNB AI Agent SDK sidecar.

Registers the agent's on-chain identity (ERC-8004) via the official `bnbagent`
SDK. This sidecar owns NO strategy, scoring, risk, mandate, or execution logic —
the TypeScript core remains the single source of truth (per the build spec). It
exists only because the BNB AI Agent SDK is Python.

It never fabricates a result: a missing package, missing wallet password, or an
on-chain failure all print a JSON error and exit non-zero. Output is a single
JSON object on stdout so the TypeScript bridge can parse it.

Env:
  BNB_AGENT_WALLET_PASSWORD   (required) wallet keystore password
  BNB_AGENT_PRIVATE_KEY       (first run only) 0x-prefixed key
  BNB_SDK_NETWORK             default "bsc" (use "bsc-testnet" for gas-free rehearsal)
  BNB_AGENT_NAME              default "wardenclaw-bsc"
  BNB_AGENT_ENDPOINT          ERC-8183 status endpoint URL
"""
import json
import os
import sys


def fail(msg: str) -> None:
    print(json.dumps({"ok": False, "error": msg}))
    sys.exit(1)


def main() -> None:
    try:
        from bnbagent import ERC8004Agent, AgentEndpoint, EVMWalletProvider
    except ImportError:
        fail("bnbagent is not installed. Run: pip install bnbagent")
        return

    password = os.getenv("BNB_AGENT_WALLET_PASSWORD")
    if not password:
        fail("BNB_AGENT_WALLET_PASSWORD is required")
        return

    network = os.getenv("BNB_SDK_NETWORK", "bsc")
    wallet = EVMWalletProvider(
        password=password,
        private_key=os.getenv("BNB_AGENT_PRIVATE_KEY"),
    )
    sdk = ERC8004Agent(network=network, wallet_provider=wallet)

    agent_uri = sdk.generate_agent_uri(
        name=os.getenv("BNB_AGENT_NAME", "wardenclaw-bsc"),
        description="WARDENCLAW BSC — spot-only, calibrated-edge trading agent",
        endpoints=[
            AgentEndpoint(
                name="ERC-8183",
                endpoint=os.getenv("BNB_AGENT_ENDPOINT", "https://wardenclaw.local/erc8183/status"),
                version="0.1.0",
            ),
        ],
    )
    result = sdk.register_agent(agent_uri=agent_uri)
    print(
        json.dumps(
            {
                "ok": True,
                "agentId": result["agentId"],
                "transactionHash": result["transactionHash"],
                "network": network,
            }
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 — surface any SDK error as JSON
        fail(str(exc))
