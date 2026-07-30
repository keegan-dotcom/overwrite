"""Covered-call backtest engine.

Black-Scholes pricing utilities plus a vectorized, event-driven covered-call
simulator over daily price paths (Derive-style cash-settled European options,
premium in quote currency).

Design notes
------------
* Time is calendar time: one step = one calendar day, year = 365 days.
  DTE is calendar days; T = dte / 365.
* The engine holds exactly 1 unit of the base asset per path and is short at
  most ONE call per unit at all times (invariant, tested).
* Where the covered-call "edge" comes from is made explicit in ``paths.py``:
  the IV process carries a per-underlying volatility-risk-premium (VRP)
  spread, so implied vol > subsequently-realized vol on average. Zero VRP
  => selling calls is (before fees) a zero-expectation trade against the
  simulator's own measure, minus the upside truncation.
* No vol skew: the 30-delta call is priced on the same IV as ATM. Equity
  index OTM calls typically trade *below* ATM IV, so if anything this
  slightly flatters the strategy. Entry premiums are calibrated against the
  July-2026 empirical anchors instead (see tests/test_backtest_calibration).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np
from scipy.special import ndtr as _ndtr, ndtri as _ndtri


class _Norm:
    """Thin fast stand-in for scipy.stats.norm (ndtr is ~5x faster)."""

    @staticmethod
    def cdf(x):
        return _ndtr(x)

    @staticmethod
    def ppf(x):
        return _ndtri(x)


norm = _Norm()

DAYS_PER_YEAR = 365.0

# ---------------------------------------------------------------------------
# Black-Scholes utilities (vectorized, no dividends by default)
# ---------------------------------------------------------------------------


def _d1(s, k, t, sigma, r, q=0.0):
    s, k, t, sigma = (np.asarray(x, dtype=float) for x in (s, k, t, sigma))
    t = np.maximum(t, 1e-12)
    sigma = np.maximum(sigma, 1e-8)
    return (np.log(s / k) + (r - q + 0.5 * sigma**2) * t) / (sigma * np.sqrt(t))


def bs_call_price(s, k, t, sigma, r=0.0, q=0.0):
    """European call price. At t<=0 returns intrinsic."""
    s, k = np.asarray(s, dtype=float), np.asarray(k, dtype=float)
    t = np.asarray(t, dtype=float)
    intrinsic = np.maximum(s - k, 0.0)
    d1 = _d1(s, k, t, sigma, r, q)
    d2 = d1 - np.maximum(np.asarray(sigma, float), 1e-8) * np.sqrt(np.maximum(t, 1e-12))
    price = s * np.exp(-q * np.maximum(t, 0.0)) * norm.cdf(d1) - k * np.exp(
        -r * np.maximum(t, 0.0)
    ) * norm.cdf(d2)
    return np.where(t <= 0, intrinsic, price)


def bs_put_price(s, k, t, sigma, r=0.0, q=0.0):
    """European put price via direct formula (used for parity tests)."""
    s, k = np.asarray(s, dtype=float), np.asarray(k, dtype=float)
    t = np.asarray(t, dtype=float)
    intrinsic = np.maximum(k - s, 0.0)
    d1 = _d1(s, k, t, sigma, r, q)
    d2 = d1 - np.maximum(np.asarray(sigma, float), 1e-8) * np.sqrt(np.maximum(t, 1e-12))
    price = k * np.exp(-r * np.maximum(t, 0.0)) * norm.cdf(-d2) - s * np.exp(
        -q * np.maximum(t, 0.0)
    ) * norm.cdf(-d1)
    return np.where(t <= 0, intrinsic, price)


def bs_call_delta(s, k, t, sigma, r=0.0, q=0.0):
    """Call delta (dPrice/dSpot). At expiry: 0/1 indicator."""
    t = np.asarray(t, dtype=float)
    d1 = _d1(s, k, t, sigma, r, q)
    expired = np.where(np.asarray(s, float) > np.asarray(k, float), 1.0, 0.0)
    return np.where(t <= 0, expired, np.exp(-q * np.maximum(t, 0.0)) * norm.cdf(d1))


def strike_for_delta(s, delta, t, sigma, r=0.0, q=0.0):
    """Strike such that the call has the given delta (exact BS inversion)."""
    s = np.asarray(s, dtype=float)
    t = np.maximum(np.asarray(t, dtype=float), 1e-12)
    sigma = np.maximum(np.asarray(sigma, dtype=float), 1e-8)
    d1 = norm.ppf(np.asarray(delta, dtype=float) / np.exp(-q * t))
    return s * np.exp((r - q + 0.5 * sigma**2) * t - d1 * sigma * np.sqrt(t))


def strike_for_price(s, target_price, t, sigma, r=0.0, q=0.0,
                     k_lo=None, k_hi=None, n_iter=60):
    """Highest strike whose call price equals ``target_price`` (vectorized
    bisection; call price is strictly decreasing in strike).

    Used for credit-only defensive rolls: buy back the tested short call for
    C, sell a new (longer-dated) call at the max strike with premium >= C.
    """
    s = np.asarray(s, dtype=float)
    target = np.asarray(target_price, dtype=float)
    lo = np.full_like(s, 1e-8) if k_lo is None else np.asarray(k_lo, float).copy()
    hi = s * 5.0 if k_hi is None else np.asarray(k_hi, float).copy()
    lo = np.broadcast_to(lo, s.shape).copy()
    hi = np.broadcast_to(hi, s.shape).copy()
    # price(lo) should be >= target, price(hi) <= target; clamp target inside.
    p_lo = bs_call_price(s, lo, t, sigma, r, q)
    target = np.minimum(target, p_lo)  # can't get more premium than at k_lo
    for _ in range(n_iter):
        mid = 0.5 * (lo + hi)
        p_mid = bs_call_price(s, mid, t, sigma, r, q)
        go_up = p_mid >= target  # still rich enough -> raise strike
        lo = np.where(go_up, mid, lo)
        hi = np.where(go_up, hi, mid)
    return lo  # lo side keeps price >= target -> credit-only guaranteed


# ---------------------------------------------------------------------------
# Engine configuration
# ---------------------------------------------------------------------------


@dataclass
class EngineConfig:
    target_delta: float = 0.30          # delta of calls sold (0.15/0.25/0.30)
    target_dte: int = 30                # days to expiry at entry (30/45)
    roll_dte: int = 21                  # close & re-open when DTE <= this
    take_profit_decay: float = 0.75     # buy back once 75% of premium decayed
    defensive_delta: float = 0.60       # credit-only roll when delta >= this
    defensive_margin: float = 0.05      # roll only if new delta <= trigger-margin
    r: float = 0.04                     # risk-free (quote ccy) rate
    q: float = 0.0                      # dividend / staking yield on base
    fee_bps_premium: float = 3.0        # maker fee, bps of premium notional
    fee_per_contract: float = 0.10      # flat fee per contract per leg, USD
    contract_size: float = 1.0          # units of base per contract
    interest_on_cash: bool = True       # premium cash earns r (quote ccy)


@dataclass
class EngineResult:
    """Per-path outputs of a covered-call run. Arrays shaped (n_paths,) unless
    noted. ``value`` is (n_paths, n_steps+1) mark-to-market portfolio value:
    spot + cash - short-call liability."""
    value: np.ndarray
    cash: np.ndarray
    cash_interest: np.ndarray
    gross_premium: np.ndarray        # sum of premiums received / path
    buyback_cost: np.ndarray         # sum paid to close calls early / path
    settlement_paid: np.ndarray      # sum of cash settlements (ITM expiry)
    fees: np.ndarray
    final_liability: np.ndarray      # mark of any still-open call at T
    n_calls_sold: np.ndarray
    n_expiries: np.ndarray
    n_itm_expiries: np.ndarray
    n_closes: np.ndarray             # every position close (any reason)
    n_closed_itm: np.ndarray         # closes with spot > strike (capped)
    n_defensive_rolls: np.ndarray
    n_take_profits: np.ndarray
    premium_by_step: np.ndarray      # (n_paths, n_steps+1) net premium flow
    quoted_premium_pct_sum: np.ndarray  # sum of entry premium / entry spot
    spot0: float

    def accounting_identity_gap(self, prices: np.ndarray) -> np.ndarray:
        """|V_T - (S_T + net option cashflows + interest - open liability)|.

        Exact to float precision by construction; the engine is only allowed
        to move money through the tracked accumulators (tested)."""
        v_t = self.value[:, -1]
        recon = (
            prices[:, -1]
            + self.gross_premium
            - self.buyback_cost
            - self.settlement_paid
            - self.fees
            + self.cash_interest
            - self.final_liability
        )
        return np.abs(v_t - recon)


# ---------------------------------------------------------------------------
# Vectorized covered-call engine
# ---------------------------------------------------------------------------


def run_covered_call(
    prices: np.ndarray,
    iv: np.ndarray,
    config: Optional[EngineConfig] = None,
) -> EngineResult:
    """Simulate a covered-call program on daily price paths.

    Parameters
    ----------
    prices : (n_paths, n_steps+1) daily spot paths (calendar days).
    iv     : (n_paths, n_steps+1) implied vol used to quote options each day
             (annualized, e.g. 0.165). Produced by ``paths.iv_paths``.
    config : EngineConfig.

    Mechanics per day, per path (priority order):
      1. If today is the short call's expiry: cash-settle max(S-K, 0).
      2. Else if call delta >= defensive_delta: credit-only roll up-and-out
         (buy back, sell new target-DTE call at the max strike whose premium
         covers the buyback cost, capped at the target-delta strike; strike
         never below the old strike). The roll only executes if it reduces
         delta to <= defensive_delta - defensive_margin — a credit-only roll
         that leaves you just as pinned is not a defense, and without this
         guard the rule re-fires every day of a rally.
      3. Else if mark <= (1 - take_profit_decay) * entry premium: buy back.
      4. Else if DTE <= roll_dte: buy back.
      After any close (1/3/4), immediately sell a fresh call at
      strike_for_delta(target_delta, target_dte) on the SAME day.
    """
    cfg = config or EngineConfig()
    prices = np.asarray(prices, dtype=float)
    iv = np.asarray(iv, dtype=float)
    if prices.shape != iv.shape:
        raise ValueError("prices and iv must have identical shapes")
    n_paths, n_cols = prices.shape
    n_steps = n_cols - 1
    r, q = cfg.r, cfg.q
    daily_growth = np.exp(r / DAYS_PER_YEAR)

    # State
    cash = np.zeros(n_paths)
    strike = np.zeros(n_paths)
    expiry = np.zeros(n_paths, dtype=int)     # day index of expiry
    entry_premium = np.zeros(n_paths)
    has_call = np.zeros(n_paths, dtype=bool)

    # Accumulators
    gross_premium = np.zeros(n_paths)
    buyback_cost = np.zeros(n_paths)
    settlement_paid = np.zeros(n_paths)
    fees = np.zeros(n_paths)
    cash_interest = np.zeros(n_paths)
    quoted_prem_pct = np.zeros(n_paths)
    n_calls_sold = np.zeros(n_paths, dtype=int)
    n_expiries = np.zeros(n_paths, dtype=int)
    n_itm = np.zeros(n_paths, dtype=int)
    n_closes = np.zeros(n_paths, dtype=int)
    n_closed_itm = np.zeros(n_paths, dtype=int)
    n_def = np.zeros(n_paths, dtype=int)
    n_tp = np.zeros(n_paths, dtype=int)

    value = np.zeros((n_paths, n_cols))
    premium_by_step = np.zeros((n_paths, n_cols))

    def _fee(premium_notional):
        return (
            np.abs(premium_notional) * cfg.fee_bps_premium * 1e-4
            + cfg.fee_per_contract * cfg.contract_size
        )

    def _sell_new(mask, t_idx):
        """Sell fresh target-delta target-DTE calls where ``mask``."""
        nonlocal cash
        if not mask.any():
            return
        s = prices[mask, t_idx]
        sig = iv[mask, t_idx]
        t_yrs = cfg.target_dte / DAYS_PER_YEAR
        k = strike_for_delta(s, cfg.target_delta, t_yrs, sig, r, q)
        prem = bs_call_price(s, k, t_yrs, sig, r, q)
        f = _fee(prem)
        strike[mask] = k
        expiry[mask] = t_idx + cfg.target_dte
        entry_premium[mask] = prem
        has_call[mask] = True
        cash[mask] += prem - f
        gross_premium[mask] += prem
        fees[mask] += f
        quoted_prem_pct[mask] += prem / s
        n_calls_sold[mask] += 1
        premium_by_step[mask, t_idx] += prem

    # Day 0: initial sale on every path
    all_mask = np.ones(n_paths, dtype=bool)
    _sell_new(all_mask, 0)
    liab0 = bs_call_price(
        prices[:, 0], strike, (expiry - 0) / DAYS_PER_YEAR, iv[:, 0], r, q
    )
    value[:, 0] = prices[:, 0] + cash - liab0

    for t in range(1, n_cols):
        if cfg.interest_on_cash:
            interest = cash * (daily_growth - 1.0)
            cash += interest
            cash_interest += interest

        s_t = prices[:, t]
        sig_t = iv[:, t]
        dte = expiry - t
        t_yrs = np.maximum(dte, 0) / DAYS_PER_YEAR

        # --- 1. Settlement at expiry (cash-settled European) --------------
        expiring = has_call & (dte <= 0)
        if expiring.any():
            payoff = np.maximum(s_t[expiring] - strike[expiring], 0.0)
            cash[expiring] -= payoff
            settlement_paid[expiring] += payoff
            n_expiries[expiring] += 1
            n_itm[expiring] += (payoff > 0).astype(int)
            n_closes[expiring] += 1
            n_closed_itm[expiring] += (payoff > 0).astype(int)
            has_call[expiring] = False

        # Current mark & delta for live calls
        live = has_call
        mark = np.zeros(n_paths)
        delta = np.zeros(n_paths)
        if live.any():
            mark[live] = bs_call_price(
                s_t[live], strike[live], t_yrs[live], sig_t[live], r, q
            )
            delta[live] = bs_call_delta(
                s_t[live], strike[live], t_yrs[live], sig_t[live], r, q
            )

        # --- 2. Defensive credit-only roll ---------------------------------
        breach = live & (delta >= cfg.defensive_delta)
        defensive = np.zeros(n_paths, dtype=bool)
        if breach.any():
            c = mark[breach]
            new_t = cfg.target_dte / DAYS_PER_YEAR
            # Max strike (>= old strike) whose new-call premium covers c,
            # capped at the target-delta strike (don't roll past target risk).
            k_solve = strike_for_price(
                s_t[breach], c, new_t, sig_t[breach], r, q,
                k_lo=strike[breach],
            )
            k_target = strike_for_delta(
                s_t[breach], cfg.target_delta, new_t, sig_t[breach], r, q
            )
            k_new = np.minimum(k_solve, np.maximum(k_target, strike[breach]))
            new_delta = bs_call_delta(s_t[breach], k_new, new_t, sig_t[breach], r, q)
            # Only roll when the roll actually de-risks; else hold and let
            # theta / the calendar roll deal with it.
            ok = new_delta <= cfg.defensive_delta - cfg.defensive_margin
            defensive[np.flatnonzero(breach)[ok]] = True
            if ok.any():
                c, k_new = c[ok], k_new[ok]
                f_close = _fee(c)
                cash[defensive] -= c + f_close
                buyback_cost[defensive] += c
                fees[defensive] += f_close
                premium_by_step[defensive, t] -= c
                n_closes[defensive] += 1
                n_closed_itm[defensive] += (
                    s_t[defensive] > strike[defensive]
                ).astype(int)
                prem = bs_call_price(s_t[defensive], k_new, new_t,
                                     sig_t[defensive], r, q)
                f_open = _fee(prem)
                cash[defensive] += prem - f_open
                fees[defensive] += f_open
                gross_premium[defensive] += prem
                quoted_prem_pct[defensive] += prem / s_t[defensive]
                premium_by_step[defensive, t] += prem
                strike[defensive] = k_new
                expiry[defensive] = t + cfg.target_dte
                entry_premium[defensive] = prem
                n_def[defensive] += 1
                n_calls_sold[defensive] += 1

        # --- 3/4. Take-profit or calendar roll: buy back then re-sell ------
        live = has_call & ~defensive
        tp = live & (mark <= (1.0 - cfg.take_profit_decay) * entry_premium)
        cal = live & ~tp & (dte <= cfg.roll_dte)
        closing = tp | cal
        if closing.any():
            c = mark[closing]
            f_close = _fee(c)
            cash[closing] -= c + f_close
            buyback_cost[closing] += c
            fees[closing] += f_close
            premium_by_step[closing, t] -= c
            n_closes[closing] += 1
            n_closed_itm[closing] += (s_t[closing] > strike[closing]).astype(int)
            has_call[closing] = False
            n_tp[tp] += 1

        # --- Re-sell wherever flat (post-settlement, post-close) -----------
        flat = ~has_call
        # Don't open a new position on the final day (nothing to simulate).
        if t < n_cols - 1:
            _sell_new(flat, t)

        # --- Mark portfolio -------------------------------------------------
        liab = np.zeros(n_paths)
        lv = has_call
        if lv.any():
            dte2 = np.maximum(expiry - t, 0) / DAYS_PER_YEAR
            liab[lv] = bs_call_price(
                s_t[lv], strike[lv], dte2[lv], sig_t[lv], r, q
            )
        value[:, t] = s_t + cash - liab
        if t == n_cols - 1:
            final_liability = liab.copy()

    return EngineResult(
        value=value,
        cash=cash,
        cash_interest=cash_interest,
        gross_premium=gross_premium,
        buyback_cost=buyback_cost,
        settlement_paid=settlement_paid,
        fees=fees,
        final_liability=final_liability,
        n_calls_sold=n_calls_sold,
        n_expiries=n_expiries,
        n_itm_expiries=n_itm,
        n_closes=n_closes,
        n_closed_itm=n_closed_itm,
        n_defensive_rolls=n_def,
        n_take_profits=n_tp,
        premium_by_step=premium_by_step,
        quoted_premium_pct_sum=quoted_prem_pct,
        spot0=float(prices[0, 0]),
    )


# ---------------------------------------------------------------------------
# Summary statistics
# ---------------------------------------------------------------------------


def summarize(result: EngineResult, prices: np.ndarray,
              config: Optional[EngineConfig] = None,
              monthly_target_annual: float = 0.10) -> dict:
    """Reduce an EngineResult to the headline stats used in validation.

    ``monthly_target_annual``: the marketing claim (10%/yr); a month "hits
    target" when net premium captured in a 30-day block >= claim/12 of the
    block-start spot.
    """
    s0 = prices[:, 0]
    v = result.value
    v0 = v[:, 0]
    total_ret = v[:, -1] / v0 - 1.0
    bh_ret = prices[:, -1] / s0 - 1.0

    daily_ret = np.diff(v, axis=1) / np.maximum(v[:, :-1], 1e-9)
    ann_vol = daily_ret.std(axis=1, ddof=1) * np.sqrt(DAYS_PER_YEAR)
    bh_daily = np.diff(prices, axis=1) / prices[:, :-1]
    bh_vol = bh_daily.std(axis=1, ddof=1) * np.sqrt(DAYS_PER_YEAR)

    peak = np.maximum.accumulate(v, axis=1)
    dd = (v - peak) / peak
    max_dd = dd.min(axis=1)
    bh_peak = np.maximum.accumulate(prices, axis=1)
    bh_dd = ((prices - bh_peak) / bh_peak).min(axis=1)

    # Monthly premium-target hit rate (30-day calendar blocks)
    n_cols = v.shape[1]
    block = 30
    hits, blocks = 0, 0
    monthly_needed = monthly_target_annual / 12.0
    for start in range(0, n_cols - block, block):
        net_prem = result.premium_by_step[:, start:start + block].sum(axis=1)
        hits += (net_prem >= monthly_needed * prices[:, start]).sum()
        blocks += net_prem.size

    any_exp = result.n_expiries.sum()
    itm_overall = result.n_itm_expiries.sum() / any_exp if any_exp else 0.0
    any_close = result.n_closes.sum()
    itm_close = result.n_closed_itm.sum() / any_close if any_close else 0.0

    # The number the marketing quotes: average premium at the sale, annualized
    # at hold-to-expiry cadence (365/target_dte sales per year).
    avg_quote = result.quoted_premium_pct_sum / np.maximum(result.n_calls_sold, 1)

    out = {
        "quoted_premium_pct_per_sale": float(avg_quote.mean()),
        "gross_premium_collected": float(np.mean(result.gross_premium / s0)),
        "net_premium_captured": float(
            np.mean(
                (result.gross_premium - result.buyback_cost
                 - result.settlement_paid - result.fees) / s0
            )
        ),
        "premium_retained": float(
            np.mean((result.gross_premium - result.buyback_cost - result.fees) / s0)
        ),
        "net_total_return_mean": float(total_ret.mean()),
        "net_total_return_median": float(np.median(total_ret)),
        "buyhold_return_mean": float(bh_ret.mean()),
        "buyhold_return_median": float(np.median(bh_ret)),
        "outperformance_mean": float((total_ret - bh_ret).mean()),
        "prob_beats_buyhold": float((total_ret > bh_ret).mean()),
        "ann_vol_median": float(np.median(ann_vol)),
        "bh_ann_vol_median": float(np.median(bh_vol)),
        "max_drawdown_median": float(np.median(max_dd)),
        "bh_max_drawdown_median": float(np.median(bh_dd)),
        "pct_months_premium_target_hit": float(hits / blocks) if blocks else float("nan"),
        "itm_settlement_frequency": float(itm_overall),
        "itm_at_close_frequency": float(itm_close),
        "defensive_rolls_per_year": float(result.n_defensive_rolls.mean()),
        "take_profits_per_year": float(result.n_take_profits.mean()),
        "calls_sold_per_year": float(result.n_calls_sold.mean()),
        "fees_pct_spot": float(np.mean(result.fees / s0)),
    }
    if config is not None:
        # Marketing arithmetic: premium per sale x hold-to-expiry cadence.
        out["quoted_premium_annualized"] = float(
            avg_quote.mean() * DAYS_PER_YEAR / config.target_dte
        )
    return out
