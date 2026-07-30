"""Black-Scholes pricing sanity tests for the Overwrite backtester."""

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backtest.engine import (  # noqa: E402
    bs_call_delta,
    bs_call_price,
    bs_put_price,
    strike_for_delta,
    strike_for_price,
)

R, Q = 0.04, 0.0


def test_put_call_parity():
    s = np.array([50.0, 100.0, 630.0, 118000.0])
    k = s * np.array([0.9, 1.0, 1.05, 1.2])
    t, sigma = 30 / 365, 0.30
    c = bs_call_price(s, k, t, sigma, R, Q)
    p = bs_put_price(s, k, t, sigma, R, Q)
    parity = s * np.exp(-Q * t) - k * np.exp(-R * t)
    assert np.all(np.abs((c - p) - parity) <= 1e-8 * s)


def test_call_price_bounds_and_intrinsic_at_expiry():
    s, sigma = 100.0, 0.45
    for k in (80.0, 100.0, 120.0):
        price = float(bs_call_price(s, k, 30 / 365, sigma, R))
        assert max(s - k * np.exp(-R * 30 / 365), 0) <= price <= s
        assert float(bs_call_price(s, k, 0.0, sigma, R)) == max(s - k, 0.0)


def test_delta_monotone_decreasing_in_strike():
    s, t, sigma = 100.0, 45 / 365, 0.45
    strikes = np.linspace(60, 180, 60)
    deltas = bs_call_delta(s, strikes, t, sigma, R)
    assert np.all(np.diff(deltas) < 0)
    assert np.all((deltas > 0) & (deltas < 1))


def test_price_monotone_decreasing_in_strike():
    s, t, sigma = 100.0, 30 / 365, 0.20
    strikes = np.linspace(70, 150, 50)
    prices = bs_call_price(s, strikes, t, sigma, R)
    assert np.all(np.diff(prices) < 0)


def test_strike_for_delta_roundtrip():
    s, t = 100.0, 30 / 365
    for sigma in (0.165, 0.45):
        for target in (0.15, 0.25, 0.30, 0.60):
            k = strike_for_delta(s, target, t, sigma, R)
            d = float(bs_call_delta(s, k, t, sigma, R))
            assert d == pytest.approx(target, abs=1e-9)
            if target < 0.5:
                assert k > s  # sub-50-delta call is OTM


def test_strike_for_price_inverts_price_and_respects_floor():
    s, t, sigma = 100.0, 30 / 365, 0.30
    target_price = float(bs_call_price(s, 105.0, t, sigma, R))
    k = strike_for_price(s, target_price, t, sigma, R)
    assert float(k) == pytest.approx(105.0, rel=1e-6)
    # premium at returned strike always >= target (credit-only guarantee)
    got = float(bs_call_price(s, k, t, sigma, R))
    assert got >= target_price - 1e-9
    # with a strike floor above the natural solution, floor binds
    k2 = strike_for_price(s, target_price, t, sigma, R, k_lo=110.0)
    assert float(k2) == pytest.approx(110.0, rel=1e-9)


def test_vega_positive_price_increases_with_vol():
    s, k, t = 100.0, 103.0, 30 / 365
    p_low = float(bs_call_price(s, k, t, 0.15, R))
    p_high = float(bs_call_price(s, k, t, 0.50, R))
    assert p_high > p_low
