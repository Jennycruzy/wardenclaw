# Deployment & Credentials (VPS, 24/7)

Everything you must obtain and set up to run WARDENCLAW BSC live on a server. Do the
setup as a **non-root sudo user**, not as `root`, and use SSH keys (disable
password login). **Rotate any password you have shared in plaintext.**

## 1. Credentials & SDKs to obtain

| What | Where | Env var(s) | Needed for |
|---|---|---|---|
| **CMC Pro API key** | pro.coinmarketcap.com | `CMC_API_KEY` | Perception (quotes/trending/fear-greed) + eligible-token contract resolution |
| **CMC x402 wallet** | a wallet on **Base** funded with a few USDC | `X402_PRIVATE_KEY`, `CMC_X402_ENDPOINT` | Pay-per-request CMC data in the trade loop ($0.01/req, EIP-3009) |
| **Trust Wallet API creds** | portal.trustwallet.com → Access ID + HMAC Secret | `TWAK_ACCESS_ID`, `TWAK_HMAC_SECRET` | Authenticating the `twak` CLI |
| **TWAK agent wallet** | created locally by the CLI | `TWAK_WALLET_PASSWORD`, `TWAK_CONFIG_PATH` | The sole signer (self-custody); enables live mode |
| **BSC RPC endpoints** | public dataseeds or a provider (QuickNode/Ankr) | `BSC_RPC_URLS` (comma-separated) | Reserves, quotes, gas, failover |
| **BNB SDK wallet** | a key for ERC-8004 agent identity | `BNB_AGENT_WALLET_PASSWORD`, `BNB_AGENT_PRIVATE_KEY` | Optional on-chain agent identity (bnbagent) |
| **Alert webhook** | Slack/Telegram/Discord incoming webhook | `ALERT_WEBHOOK_URL` | Phone alerts |
| **Kill-switch token** | any strong random string you choose | `KILL_SWITCH_TOKEN` | Authenticated emergency stop |

SDKs/CLIs installed on the box: Node ≥ 20, `pnpm`, Python 3, and the Trust Wallet
CLI (`npm i -g @trustwallet/cli`). The BNB AI Agent SDK (`bnbagent`) installs into
the sidecar's Python venv only if you use on-chain identity registration.

## 2. One-time server setup (Ubuntu)

```bash
# as a sudo user, not root
sudo apt update && sudo apt install -y git python3 python3-venv build-essential
# Node 20 + pnpm
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pnpm pm2 @trustwallet/cli

git clone <your-repo-url> wardenclaw && cd wardenclaw
pnpm install
cp .env.example .env        # fill in the table above
```

### Configure TWAK (self-custody signer)

```bash
export TWAK_ACCESS_ID=...    # do NOT pass as CLI flags
export TWAK_HMAC_SECRET=...
twak init                    # stores creds in ~/.twak (0600) + OS keychain
twak wallet create --password "$TWAK_WALLET_PASSWORD"
twak wallet status --json    # note the BSC address → set TWAK_AGENT_WALLET
```

Point `TWAK_CONFIG_PATH=~/.twak` in `.env` (its presence flips the worker to live).

### (Optional) BNB AI Agent SDK sidecar

```bash
cd apps/bnb-sdk-sidecar
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
cd ../..
# set BNB_SDK_REGISTER=true to register the agent identity at worker startup
```

## 3. Pre-flight (do this before June 22)

```bash
pnpm build:eligible-tokens          # CMC-resolved contracts
pnpm calibrate:edge                 # real calibration
pnpm verify:integrations -- --live  # must pass
twak compete register --json        # → record "hash" as REGISTRATION_TX_HASH
pnpm rehearsal:checklist            # complete the manual live steps → gate passes
```

Fund the TWAK wallet with **eligible stables (e.g. USDT) + a little native BNB for
gas**. Fund the Base x402 wallet with a few USDC.

## 4. Run under pm2 (auto-restart, boot-on-reboot)

```bash
pm2 start ops/pm2.config.cjs
pm2 save && pm2 startup        # follow the printed command
pm2 logs wardenclaw-worker
```

The worker refuses live mode unless the rehearsal gate passed (override only after
manual confirmation: `REHEARSAL_OVERRIDE=true`). The API serves the kill-switch on
`API_PORT` (default 4000) — expose it only behind auth/HTTPS, and stop trading from
your phone with:

```bash
curl -X POST https://<your-host>:4000/kill -H "authorization: Bearer $KILL_SWITCH_TOKEN"
```

## 5. Security checklist

- [ ] Root password rotated; password SSH login disabled; key-only access.
- [ ] `.env`, `~/.twak`, and the sidecar venv are mode-restricted and never committed.
- [ ] The x402 Base wallet holds only a small USDC float.
- [ ] The agent wallet holds only the ~$40 book + gas.
- [ ] `KILL_SWITCH_TOKEN` is strong and the `/kill` endpoint is reachable from your phone.
- [ ] Alerts confirmed arriving on your phone (`POST /alert/test`).
