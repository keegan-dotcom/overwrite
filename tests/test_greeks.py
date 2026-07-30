"""BS utility sanity tests (agent-side; backtest has its own)."""
import math

import pytest

from agent.strategy import greeks


def test_put_call_parity():
    s, k, v, t, r = 100.0, 105.0, 0.4, 0.25, 0.03
    c = greeks.call_price(s, k, v, t, r)
    p = greeks.put_price(s, k, v, t, r)
    assert abs((c - p) - (s - k * math.exp(-r * t))) < 1e-9


def test_delta_bounds_and_monotonicity():
    s, v, t = 100.0, 0.5, 0.1
    deltas = [greeks.call_delta(s, k, v, t) for k in (70, 90, 100, 110, 140)]
    assert all(0 < d < 1 for d in deltas)
    assert deltas == sorted(deltas, reverse=True)


def test_strike_for_delta_roundtrip():
    s, v, t = 3800.0, 0.5, 35 / 365
    for target in (0.15, 0.25, 0.30):
        k = greeks.strike_for_delta(s, target, v, t)
        assert abs(greeks.call_delta(s, k, v, t) - target) < 1e-6
        assert k > s  # OTM call for delta < 0.5


def test_annualized_yield():
    y = greeks.annualized_premium_yield(premium=38.0, spot=3800.0, dte_days=36.5)
    assert abs(y - 0.10) < 1e-9


def test_expiry_edge_cases():
    assert greeks.call_price(100, 90, 0.5, 0) == 10
    assert greeks.call_delta(100, 90, 0.5, 0) == 1.0
    assert greeks.call_delta(100, 110, 0.5, 0) == 0.0
