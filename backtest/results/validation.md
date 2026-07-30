# Overwrite covered-call yield validation

Monte Carlo, 2000 paths x 1yr per cell, GBM + Merton jumps calibrated to July 2026 IV30 anchors (SPY 16.5%, AAPL 22%, NVDA 44.5%, TSLA 45%, BTC 37.5%, ETH 50%); entry premiums reproduce the observed 30-delta 30-DTE anchors (SPY 0.88%, AAPL 1.16%, NVDA 2.27% of spot) to within 1%. Edge source is an explicit implied-minus-realized vol spread (VRP): SPY 3.0 pts, AAPL 4.0, NVDA/TSLA 7.0, BTC 5.0, ETH 7.0. Strategy: sell 1 covered call per unit, cash-settled European (Derive-style), roll at 21 DTE, take-profit at 75% premium decay, credit-only defensive roll at 0.60 delta, maker fee 3bps of premium + $0.10/contract.

## Verdict: is ~10% annualized premium yield realistic?

| Underlying | Quoted premium (0.30d/30DTE, ann.) | Net premium kept (base) | Clears 10% gross? | Net vs B&H: bear / flat / base / bull / moon | Months hitting 10%/12 target |
|---|---|---|---|---|---|
| SPY | 10.7% | +1.6% | marginal | +8.4% / +3.0% / +0.8% / -4.4% / -15.8% | 36.1% |
| AAPL | 13.9% | +0.5% | **yes** | +6.8% / +1.6% / -0.6% / -5.4% / -16.8% | 44.7% |
| NVDA | 27.2% | +3.8% | **yes** | +8.7% / +3.8% / +1.9% / -2.9% / -13.3% | 57.6% |
| TSLA | 27.3% | +5.2% | **yes** | +10.8% / +5.9% / +3.2% / -1.5% / -10.8% | 57.5% |
| BTC | 23.3% | +5.7% | **yes** | +12.1% / +6.5% / +4.0% / -0.5% / -10.6% | 53.4% |
| ETH | 30.5% | +8.0% | **yes** | +13.7% / +8.2% / +5.8% / +1.8% / -8.5% | 57.7% |

*Quoted premium = average premium at sale x hold-to-expiry cadence (the number a marketing page would quote). Net premium kept = premiums minus buybacks, settlements and fees — what actually lands in the account after the option leg is settled up.*

## Findings

- **The '~10% yield' is a gross-premium statement, and only high-IV names clear it comfortably.** At 0.30 delta / 30 DTE the annualized quoted premium is ~10.7% on SPY (right at the claim), ~13.9% on AAPL, and 23.3%–30.5% on NVDA/TSLA/BTC/ETH. At 0.15 delta — the 'rarely called away' setting — SPY quotes only 4.3% and the claim is out of reach on anything but the high-IV names. But quoted premium is not return: net premium actually kept in the base scenario is +1.6% (SPY) to +8.0% (ETH) because winners get bought back and ITM calls are paid off.
- **What it costs: upside.** In the bull scenario (+25%/yr) the 0.30-delta program lags buy-and-hold by 4.4% on SPY and 2.9% on NVDA; in the moon scenario (+60%) the lag reaches 16.8% (AAPL) and 8.5% (ETH). This matches the BXMD record (lags ~5pts in strong bull years) — the strategy sells exactly the outcomes crypto/tech holders buy these assets for. The one exception: ETH still edges out buy-and-hold in the +25% case (+1.8%) because a +25% year is only ~0.5 sigma for a 50-vol asset and the assumed 7-pt crypto VRP is large — that result stands or falls with the VRP persisting.
- **Where it wins: flat-to-down markets and risk metrics.** Volatility drops roughly a third (SPY 9.5% vs 13.5%; ETH 28.7% vs 42.5%), median max drawdown improves in every cell, and in bear/flat scenarios the program beats holding by +13.7% (ETH bear) and +8.2% (ETH flat).
- **The monthly cadence is lumpy.** Even where the annualized quoted premium clears 10%, only 36.1% (SPY) to 57.7% (ETH) of months actually net >= 10%/12 of spot after buybacks — a chunk of collected premium is routinely handed back rolling calls that went ITM. Marketing a smooth '10% APY' would misrepresent the cashflow profile.
- **Sanity vs listed-market history.** Simulated SPY 0.30-delta nets +8.6% vs +7.8% buy-hold in the +8% base case and lags ~4.4% in the bull case — consistent with BXMD vs S&P 500 (10.4% vs 10.9%/yr since 1986, ~5pt lag in strong bull years). QYLD-style NAV erosion shows up only if premium is distributed rather than reinvested: the engine reinvests, so flat/bear scenarios preserve capital.

## Caveats (read before quoting these numbers)

- Monte Carlo, not history: paths are GBM+jumps under assumed drift scenarios. The historical loader (`backtest.paths.load_historical`) requires network and runs on your machine, not in this sandbox.
- No vol skew (flat smile per date) and no discrete strike/expiry grid; premiums are pinned to July-2026 anchors at entry instead.
- The VRP parameters ARE the edge. Set VRP to 0 and net premium captured drops roughly by the VRP's vega value — if you believe option markets on these names are fairly priced, expect the covered call to strictly lose vs holding in up markets.
- Derive-specific frictions (spread crossing on illiquid strikes, funding/collateral haircuts, oracle settlement) are modeled only as a 3bps + $0.10 fee; on thin books effective costs can be several times larger.