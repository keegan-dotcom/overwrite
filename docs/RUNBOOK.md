# Runbook

## 0. Prerequisites

* Python 3.11+, `pip install -r requirements.txt`
* Node 18+ for contracts (`cd contracts && npm install`)
* A wallet you control (fresh dev wallet recommended — never your main key)

## 1. Derive testnet onboarding (once, ~10 minutes)

Derive's testnet is the v2 stack: app at **testnet.derive.xyz**, API at
**api-demo.lyra.finance**, an OP-stack chain hosted by Conduit.

1. Go to https://testnet.derive.xyz with a fresh browser wallet (e.g. a new
   MetaMask account). Sign in — this deploys your Derive **smart-contract
   wallet** and creates a **subaccount**.
2. Get ~0.1–0.3 Sepolia ETH from any public faucet (Alchemy/Infura run
   reliable ones) — needed for the L1 side of testnet deposits.
3. Use the testnet faucet in the app UI to fund the subaccount with test
   USDC + ETH. NOTE: it's a drip **inside the deposit flow**, not a
   standalone "Faucet" button — open Deposit and look there.
4. Create a **session key** for the agent: Developers → Session Keys in the
   app (or `register_session_key` via API). Scope it to trading only. Export
   its private key.
5. Find your identifiers:
   - `DERIVE_WALLET` — the smart-contract wallet address (shown in the app)
   - `DERIVE_SUBACCOUNT_ID` — integer id (shown in the app / API)
   - `DERIVE_SESSION_KEY` — the session key's private key
6. `cp .env.example .env`, fill the three values. `set -a; source .env` or use
   direnv/dotenv.

Sanity check:

```bash
python - <<'EOF'
from derive_client import HTTPClient
from derive_client.data_types import Environment
import os
c = HTTPClient(wallet=os.environ["DERIVE_WALLET"],
               session_key=os.environ["DERIVE_SESSION_KEY"],
               subaccount_id=int(os.environ["DERIVE_SUBACCOUNT_ID"]),
               env=Environment.TEST)
c.connect()
print("connected; collaterals:", c.collateral.get())
EOF
```

## 2. Running

```bash
# one decision cycle, log what WOULD happen (default safe mode):
python -m agent.main once --config configs/config.example.yaml

# continuous loop, still dry-run:
python -m agent.main run --config configs/config.example.yaml

# live on testnet: set dry_run: false in YAML, then ALSO pass --live
python -m agent.main run --config configs/config.example.yaml --live

# status: premium collected, orders, equity HWM, recent cycles
python -m agent.main status --config configs/config.example.yaml

# emergency: buy back all short calls
python -m agent.main close-all --config configs/config.example.yaml --live
```

Run it unattended with systemd (or a screen/tmux session):

```ini
# /etc/systemd/system/overwrite.service
[Unit]
Description=Overwrite covered-call agent
After=network-online.target
[Service]
WorkingDirectory=/opt/overwrite
EnvironmentFile=/opt/overwrite/.env
ExecStart=/usr/bin/python3 -m agent.main run --config configs/config.yaml --live
Restart=on-failure
RestartSec=30
[Install]
WantedBy=multi-user.target
```

## 3. Controls while running

| Action | How |
|---|---|
| Hard stop everything | `touch data/KILL` (remove file to resume; also vetoes `close-all` orders — remove KILL first if you intend to flatten) |
| Stop new sells, allow unwinds | `touch data/PAUSE` |
| Flatten book | `python -m agent.main close-all ... --live` |
| Watch logs | `tail -f data/logs/agent.log` |
| Inspect DB | `sqlite3 data/overwrite.db 'select * from ledger order by ts desc limit 20;'` |

## 4. Going to mainnet (later, deliberately)

1. Change `derive.environment: prod` — endpoints switch to api.lyra.finance /
   Derive Chain (id 957).
2. Fund the subaccount with the base asset (ETH/wBTC) you intend to overwrite.
3. Start with `max_utilization: 0.25` and one underlying. Raise slowly.
4. Register for Derive's **API Broker** program (fee rebates) and set
   `derive.extra_fee` if monetizing order flow via Builder Codes.
5. Do NOT wire the vault contracts to real deposits before a professional
   audit and Derive DAO deployer whitelisting. The agent alone (your own
   subaccount, your own funds) needs neither.

## 5. Failure modes & responses

| Symptom | Likely cause | Response |
|---|---|---|
| `risk rule error ... failing closed` in logs | venue API hiccup | transient; investigate if persistent |
| Everything vetoed "stale quote" | API latency / clock skew | check NTP, raise `max_quote_age_sec` cautiously |
| Orders never fill | book thinner than mock assumptions | raise `aggression`, widen `max_spread_pct`, or accept fewer fills |
| `COVERAGE VIOLATION` veto | balances API returned partial data | good — that's the rail working; investigate before overriding |
| Margin usage climbing | short calls deep ITM in a rally | expected; defensive roll engages at 0.60Δ if credit exists, else hold-to-settle. Do not panic-close into a spike. |

## 6. When Derive lists tokenized stocks

1. Find the currency code (`markets.get_all_currencies`) — e.g. `AAPLX`.
2. Add to `DEFAULT_SYMBOL_MAP` in `agent/venues/derive.py`.
3. Flip `enabled: true` on the stub in your YAML; parameters are pre-tuned
   from the validation run (see `backtest/results/validation.md`).
4. Fund the subaccount with the tokenized stock as collateral.
5. Run `once` in dry-run, read the intents, then go live.
