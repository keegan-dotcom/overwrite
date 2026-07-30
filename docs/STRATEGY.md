# Strategy specification

## What the agent does

For each enabled underlying, every cycle (default 15 min):

1. **Snapshot** — spot, full option chain (with venue greeks), open short
   calls, base-asset balance in the subaccount.
2. **Manage existing shorts** (in priority order):
   - **Take-profit**: buy back once mark ≤ 25% of the premium received
     (75% decay captured). Re-sell next cycle at fresh strikes.
   - **Roll window**: buy back at ≤ 21 DTE. Gamma, pin and (on TradFi venues)
     assignment risk concentrate in the last three weeks; premium capture per
     unit of risk collapses. Derive options are European/cash-settled so
     there's no early-assignment risk, but the gamma argument stands.
   - **Defensive roll at 0.60Δ** — only executes if a replacement exists that
     is BOTH net-credit AND at least 0.10 lower delta. A credit-only rule
     without the de-risk guard re-fires ~80×/yr in a melt-up and churns fees
     (measured in our simulation). If no such roll exists: hold to
     settlement. Debit rolls are never allowed — that's the QYLD
     death-spiral mechanic.
3. **Sell new calls** with free capacity (held units × `max_utilization`
   − outstanding shorts):
   - expiry in [21, 60] DTE, nearest 35 DTE
   - delta in [0.12, 0.35], nearest 0.25 target
   - bid present, spread ≤ 15% of mid, annualized premium ≥ per-asset floor
   - never exceeds coverage — hard invariant, enforced again by the risk gate.

## Why delta-targeting (not % OTM)

A fixed 5%-OTM call is 0.40Δ on SPY but 0.20Δ on TSLA. Delta self-adjusts to
each asset's vol regime, keeping the *probability* of capping upside roughly
constant across underlyings and time. This is the consensus practitioner
approach (tastytrade mechanics, CBOE BXMD methodology).

## Where the yield comes from (and its limits)

The edge is the **volatility risk premium**: implied vol systematically prices
above subsequently-realized vol (SPY ~2–4 vol pts long-run; crypto larger).
Selling optionality harvests it. The costs:

- **Upside truncation.** ~9–11% of cycles close ITM in our simulation. In a
  +25% year the strategy lags buy-and-hold by ~0.5–5.5pts depending on the
  asset; in a +60% melt-up by 8–17pts.
- **Full downside retention.** Premium is income, not a hedge: one -20% gap
  costs ~10 months of SPY premium.
- **Lumpy cashflow.** Even where annualized premium clears 10%, only 36–58%
  of individual months hit 10%/12. Do not market a smooth APY.

Validation (2000 Monte-Carlo paths × 1yr × 5 drift regimes, VRP calibrated so
SPY reproduces the 40-year BXM/BXMD record; entry premiums match live
July 2026 quotes to <1%): see `backtest/results/validation.md` and
`.json`. Re-run: `python -m backtest.run_validation`.

| Underlying | IV used | Gross ann. premium (0.30Δ/30d) | Net edge vs B&H, base drift |
|---|---|---|---|
| SPY | 16.5% | 10.7% | +0.8pt |
| AAPL | 22% | 13.9% | -0.6pt |
| NVDA | 44.5% | 27.2% | +1.9pt |
| TSLA | 45% | 27.3% | +3.2pt |
| BTC | ~38% | 23.3% | +4.0pt |
| ETH | ~50% | 30.5% | +5.8pt |

**Product positioning implication:** quote *gross premium yield* prominently
(it's real and it's what the "10% on Apple" pitch refers to), disclose the
bull-market lag, and let depositors pick their delta (0.15 conservative /
0.25 standard / 0.30 aggressive) — the honest version of what the covered-call
ETF complex does with less disclosure.

## Parameters (per underlying, YAML)

| Param | Default | Notes |
|---|---|---|
| `delta_target` (min/max band) | 0.25 (0.12–0.35) | 0.30 for SPY to clear 10% gross |
| `dte_target` (min/max) | 35 (21–60) | 30–45 sweet spot: theta vs. liquidity |
| `roll_dte` | 21 | tastytrade-style management point |
| `take_profit_pct` | 0.75 | recycle capital once premium mostly captured |
| `defensive_delta` | 0.60 | + de-risk guard 0.10 |
| `max_utilization` | 0.90 | fraction of held units overwritten |
| `min_annualized_yield` | asset-specific | skip cycles when vol too cheap |
| `max_spread_pct` | 0.15 | liquidity floor |

## Known limitations

- **No earnings calendar awareness** (single-name equities): premium is
  richest into earnings precisely because gap risk is. When equities go live,
  add an earnings filter before enabling AAPL/NVDA/TSLA (tracked in TODO).
- **No IV-rank gating**: the `min_annualized_yield` floor partially proxies
  for it; a proper IV-rank filter needs IV history, which accumulates in the
  state DB over time.
- **Oracle/settlement basis**: Derive settles to its oracle's 30-min TWAP;
  tokenized-stock oracles during US market close are an open venue-level
  question for v3 — revisit at listing.
- The backtest models fills at bid and Derive-like fees; a thin testnet book
  fills worse. Watch realized premium-vs-mark slippage in `status` output.
