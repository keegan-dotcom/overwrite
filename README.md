# Overwrite

**Automated covered-call yield on Derive — built for the tokenized-stock era.**

Overwrite is an agent + vault system that systematically sells covered calls
on assets held in a [Derive](https://derive.xyz) subaccount (the largest
on-chain options venue, ~90% of on-chain options volume). It runs on ETH/BTC
today and is architected so that tokenized stocks (AAPL, NVDA, TSLA, SPY)
slot in as a **config change** the day Derive's v3 RWA expansion lists
equity options.

```
┌─────────────┐   deposits    ┌──────────────────┐   session key   ┌─────────────┐
│  Depositors  ├──────────────▶│  OverwriteVault   │◀───────────────┤    Agent     │
│ (ERC-20 base)│   shares      │  (TSA-pattern,    │    trades via   │ (this repo,  │
└─────────────┘◀──────────────│   contracts/)     │    orderbook    │  agent/)     │
                               └────────┬─────────┘                 └──────┬──────┘
                                        │ collateral                        │ sell calls,
                                        ▼                                   ▼ roll, settle
                               ┌──────────────────┐                ┌─────────────────┐
                               │ Derive subaccount │◀──────────────▶│ Derive orderbook │
                               └──────────────────┘                └─────────────────┘
```

## What's in the box

| Path | What | Status |
|---|---|---|
| `agent/` | The covered-call agent: strategy engine, risk rails, Derive + mock venue adapters, CLI | ✅ 53 tests |
| `contracts/` | Morpho-style ERC-20 share vault (Derive TSA pattern), UUPS, fees, withdrawal queue, factory | ✅ 25 tests, unaudited |
| `backtest/` | Calibrated Monte-Carlo validation of the strategy + reusable backtester | ✅ 34 tests |
| `web/` | Landing page + operator dashboard (Vite/React/Tailwind; deploys to Vercel) | ✅ builds |
| `docs/` | Runbook (incl. Derive testnet onboarding), strategy spec, business memo | — |

## The honest yield picture

From the validation run (`backtest/results/validation.md`), 0.25–0.30Δ / 30–45 DTE,
current IVs, VRP-calibrated to CBOE BXM/BXMD history:

| Underlying | Gross premium (ann.) | Clears "10% yield"? | Cost in a +25% year vs holding |
|---|---|---|---|
| ETH | ~30% | ✅ easily | ~+2pts (still ahead) |
| BTC | ~23% | ✅ | ~-0.5pt |
| NVDA / TSLA | ~27% | ✅ | -1.5 to -3pts |
| AAPL | ~14% | ✅ | ~-5pts |
| SPY | ~10.7% | ⚠️ marginal | ~-4.4pts |

**Premium yield ≠ total return.** Covered calls keep full downside and cap
upside; the strategy's edge is the volatility risk premium, which is real but
modest. This repo's marketing surface should always quote *gross premium
yield* with that caveat — see `docs/STRATEGY.md` for the full analysis.

## Quickstart

```bash
pip install -r requirements.txt

# 1. Simulated exchange, no keys needed:
python -m agent.main once --config configs/config.example.yaml   # dry-run by default

# 2. Derive TESTNET (see docs/RUNBOOK.md for onboarding):
cp .env.example .env    # fill DERIVE_WALLET / DERIVE_SESSION_KEY / DERIVE_SUBACCOUNT_ID
python -m agent.main once --config configs/config.example.yaml            # dry-run
python -m agent.main run  --config configs/config.example.yaml --live     # real testnet orders

# tests
python -m pytest tests/ -q          # agent + backtest (87)
cd contracts && npx hardhat test    # vault contracts (25)
```

## Safety model

* **Covered, always.** The engine cannot sell more calls than base units held
  (enforced twice: strategy + risk gate).
* **Dry-run by default.** Real orders require `dry_run: false` in YAML *and*
  `--live` on the CLI.
* **Kill switch** (`touch data/KILL`) halts everything; `data/PAUSE` stops new
  sells but allows buy-backs.
* **Limit orders only**, price-laddered from mid toward the touch, sanity-checked
  against mark, stale quotes rejected. Market orders are unsupported by design.
* **Margin/drawdown ceilings**: no new risk above 40% maintenance usage or
  below -15% from equity high-water.
* Contracts: guardian pause, deposit caps, fee hard-caps, first-depositor
  inflation guard, keeper-oracle deviation/staleness bounds. **Unaudited** —
  do not take external deposits before an audit.

## Revenue hooks (the business)

* `derive.extra_fee` — Derive **Builder Codes**: a per-trade fee in USDC that
  accrues to your Derive wallet (no permission needed; register for the API
  Broker program for 10–50% fee rebates on top).
* Vault fees — management (≤2%) + performance above HWM (≤30%) minted as
  shares to `feeRecipient`.
* See `docs/BUSINESS.md` for TAM, competitive whitespace and the regulatory map.

## Equities readiness

`agent/venues/derive.py:DEFAULT_SYMBOL_MAP` + `configs/config.example.yaml`
carry disabled stubs for AAPL/NVDA/TSLA/SPY with pre-tuned parameters from the
validation run. When Derive lists tokenized-stock options: add the Derive
currency code to the map, flip `enabled: true`, done.

---
*Not investment advice. Options selling caps upside and retains downside.
Derive testnet first; real funds only after you've watched it run and read
`docs/STRATEGY.md`.*
