"""Calibration checks against the July-2026 empirical anchors.

Anchors (treated as ground truth):
  - 30-delta 30-DTE premium as % of spot: SPY 0.88%, AAPL 1.16%, NVDA 2.27%,
    TSLA ~2.3-2.8%.
  - IV30: SPY 16.5%, AAPL 22%, NVDA 44.5%, TSLA 45%, ETH 45-55%, BTC 35-40%.
  - Simulated realized vol must come in BELOW implied on average (VRP > 0):
    that spread is the strategy's entire structural edge.
"""

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backtest.engine import (  # noqa: E402
    DAYS_PER_YEAR,
    bs_call_price,
    strike_for_delta,
)
from backtest.paths import UNDERLYINGS, iv_paths, simulate_paths  # noqa: E402

R = 0.04
ANCHORS_PREMIUM = {"SPY": 0.0088, "AAPL": 0.0116, "NVDA": 0.0227,
                   "TSLA": 0.0255}


@pytest.mark.parametrize("name,anchor", sorted(ANCHORS_PREMIUM.items()))
def test_30delta_30dte_premium_within_25pct_of_anchor(name, anchor):
    spec = UNDERLYINGS[name]
    t = 30 / DAYS_PER_YEAR
    k = strike_for_delta(spec.spot, 0.30, t, spec.iv0, R)
    prem_pct = float(bs_call_price(spec.spot, k, t, spec.iv0, R)) / spec.spot
    assert prem_pct == pytest.approx(anchor, rel=0.25)


def test_iv_anchor_ranges():
    assert UNDERLYINGS["SPY"].iv0 == pytest.approx(0.165)
    assert UNDERLYINGS["AAPL"].iv0 == pytest.approx(0.22)
    assert UNDERLYINGS["NVDA"].iv0 == pytest.approx(0.445)
    assert UNDERLYINGS["TSLA"].iv0 == pytest.approx(0.45, abs=0.03)
    assert 0.45 <= UNDERLYINGS["ETH"].iv0 <= 0.55
    assert 0.35 <= UNDERLYINGS["BTC"].iv0 <= 0.40


@pytest.mark.parametrize("name", sorted(UNDERLYINGS))
def test_simulated_realized_vol_matches_calibration(name):
    """Path realized vol ~= rv_longrun target (IV anchor minus VRP)."""
    spec = UNDERLYINGS[name]
    px = simulate_paths(spec, 0.0, n_paths=800, n_days=365, seed=5)
    rets = np.diff(np.log(px), axis=1)
    rv = rets.std(ddof=1) * np.sqrt(DAYS_PER_YEAR)
    assert rv == pytest.approx(spec.rv_longrun, rel=0.10)


@pytest.mark.parametrize("name", sorted(UNDERLYINGS))
def test_vrp_implied_exceeds_realized(name):
    """Average quoted IV must exceed average realized vol by roughly the
    configured VRP — the explicit, calibrated source of covered-call edge."""
    spec = UNDERLYINGS[name]
    px = simulate_paths(spec, 0.0, n_paths=500, n_days=365, seed=6)
    iv = iv_paths(px, spec, seed=7)
    rets = np.diff(np.log(px), axis=1)
    rv = rets.std(ddof=1) * np.sqrt(DAYS_PER_YEAR)
    spread = iv.mean() - rv
    assert spread > 0.4 * spec.vrp  # decisively positive
    assert spread == pytest.approx(spec.vrp, abs=0.03)


def test_drift_scenarios_hit_expected_return():
    """Jump compensation: E[S_T/S_0] - 1 ~= scenario target."""
    spec = UNDERLYINGS["NVDA"]  # jumpy name = hardest case
    for target in (-0.20, 0.0, 0.25):
        px = simulate_paths(spec, target, n_paths=20000, n_days=365, seed=8)
        mean_ret = px[:, -1].mean() / px[0, 0] - 1.0
        assert mean_ret == pytest.approx(target, abs=0.03)


def test_historical_loader_offline_behavior():
    """Offline, load_historical must raise a clear RuntimeError (or, if
    yfinance happens to be importable and networked, return a price array).
    It must never crash the package at import time."""
    from backtest import paths as p

    if p._yf is None:
        with pytest.raises(RuntimeError, match="yfinance"):
            p.load_historical("SPY")
    else:  # pragma: no cover - only on networked machines
        try:
            px = p.load_historical("SPY", start="2024-01-01")
            assert px.ndim == 2 and px.shape[1] > 10
        except RuntimeError:
            pass  # network blocked even though import worked
