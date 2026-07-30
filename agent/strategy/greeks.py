"""Black-Scholes utilities used for sanity checks and the mock venue.

Live trading uses the venue's own greeks (Derive tickers carry delta/IV/mark);
these functions exist so the agent can *verify* venue numbers and so the mock
venue can generate realistic chains.
"""
from __future__ import annotations

import math

SQRT_2 = math.sqrt(2.0)


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / SQRT_2))


def d1(spot: float, strike: float, vol: float, t_years: float, r: float = 0.0) -> float:
    if t_years <= 0 or vol <= 0 or spot <= 0 or strike <= 0:
        raise ValueError("d1 requires positive spot, strike, vol, t")
    return (math.log(spot / strike) + (r + 0.5 * vol * vol) * t_years) / (
        vol * math.sqrt(t_years)
    )


def call_price(spot: float, strike: float, vol: float, t_years: float, r: float = 0.0) -> float:
    if t_years <= 0:
        return max(0.0, spot - strike)
    _d1 = d1(spot, strike, vol, t_years, r)
    _d2 = _d1 - vol * math.sqrt(t_years)
    return spot * _norm_cdf(_d1) - strike * math.exp(-r * t_years) * _norm_cdf(_d2)


def put_price(spot: float, strike: float, vol: float, t_years: float, r: float = 0.0) -> float:
    if t_years <= 0:
        return max(0.0, strike - spot)
    c = call_price(spot, strike, vol, t_years, r)
    return c - spot + strike * math.exp(-r * t_years)


def call_delta(spot: float, strike: float, vol: float, t_years: float, r: float = 0.0) -> float:
    if t_years <= 0:
        return 1.0 if spot > strike else 0.0
    return _norm_cdf(d1(spot, strike, vol, t_years, r))


def strike_for_delta(
    spot: float, target_delta: float, vol: float, t_years: float, r: float = 0.0
) -> float:
    """Invert delta -> strike for a call (exact, via inverse normal CDF)."""
    if not (0 < target_delta < 1):
        raise ValueError("delta must be in (0,1)")
    # inverse CDF via Beasley-Springer/Moro-lite: use math.erfinv equivalent
    z = _inv_norm_cdf(target_delta)
    return spot * math.exp((r + 0.5 * vol * vol) * t_years - z * vol * math.sqrt(t_years))


def _inv_norm_cdf(p: float) -> float:
    """Acklam's rational approximation (|error| < 1.15e-9)."""
    if not (0.0 < p < 1.0):
        raise ValueError("p in (0,1)")
    a = [-3.969683028665376e01, 2.209460984245205e02, -2.759285104469687e02,
         1.383577518672690e02, -3.066479806614716e01, 2.506628277459239e00]
    b = [-5.447609879822406e01, 1.615858368580409e02, -1.556989798598866e02,
         6.680131188771972e01, -1.328068155288572e01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e00,
         -2.549732539343734e00, 4.374664141464968e00, 2.938163982698783e00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e00,
         3.754408661907416e00]
    plow, phigh = 0.02425, 1 - 0.02425
    if p < plow:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / (
            (((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1
        )
    if p > phigh:
        q = math.sqrt(-2 * math.log(1 - p))
        return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / (
            (((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1
        )
    q = p - 0.5
    r_ = q * q
    return (((((a[0] * r_ + a[1]) * r_ + a[2]) * r_ + a[3]) * r_ + a[4]) * r_ + a[5]) * q / (
        (((((b[0] * r_ + b[1]) * r_ + b[2]) * r_ + b[3]) * r_ + b[4]) * r_ + 1)
    )


def annualized_premium_yield(premium: float, spot: float, dte_days: float) -> float:
    """Gross annualized premium yield of one covered call cycle."""
    if spot <= 0 or dte_days <= 0:
        return 0.0
    return (premium / spot) * (365.0 / dte_days)
