"""Price-path and implied-vol generation for the Overwrite backtester.

Two path sources:

1. ``simulate_paths`` — Monte Carlo: GBM + Merton (compound-Poisson lognormal)
   jumps, calibrated per underlying. Jumps are sized to earnings-gap moves for
   single names, and to liquidation-cascade moves for crypto.

2. ``load_historical`` — thin yfinance loader. This sandbox has NO market-data
   network access; the loader is import-guarded so its absence never crashes
   the package. Run it on a machine with internet:

       from backtest.paths import load_historical
       px = load_historical("SPY", start="2015-01-01")   # daily closes

Calibration (July 2026 empirical anchors, treated as ground truth):

  IV30 now: SPY 16.5%, AAPL ~22% (non-earnings), NVDA 44.5%, TSLA ~45%,
  ETH ~50% (45-55 range), BTC ~37.5% (35-40 range).

  The volatility-risk premium (VRP) is the explicit source of covered-call
  edge: implied vol exceeds subsequently-realized vol on average. We set
  long-run realized vol = IV30 anchor - VRP, so option sellers harvest the
  spread in expectation. SPY IV-RV spread is empirically ~2-4 vol pts; the
  high-vol names carry a larger absolute spread but a proportionally similar
  one (~15-20% of the vol level).

Implied-vol process (per path):
  RV_t   = EWMA realized vol of the path's own daily returns (lambda=0.94)
  IV*_t  = RV_t + VRP                       (fair-value quote incl. premium)
  IV_t   = IV_{t-1} + kappa*(IV*_t - IV_{t-1}) + vol-of-vol noise, clamped.
  IV_0   = the July-2026 IV30 anchor.

So IV mean-reverts toward (regime realized vol + VRP): vol spikes feed into
richer option quotes with a lag, exactly as listed IV behaves.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional

import numpy as np

from .engine import DAYS_PER_YEAR

# ---------------------------------------------------------------------------
# Underlying calibration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class UnderlyingSpec:
    name: str
    spot: float              # rough July-2026 spot, USD (sets $-fee scale)
    iv0: float               # IV30 anchor (annualized)
    vrp: float               # implied-minus-realized spread, vol points
    jump_lambda: float       # jumps per year
    jump_mean: float         # mean log-jump
    jump_std: float          # std of log-jump
    kind: str = "equity"     # "equity" | "crypto"

    @property
    def rv_longrun(self) -> float:
        """Long-run total realized vol implied by the anchor minus VRP."""
        return self.iv0 - self.vrp

    @property
    def jump_var_annual(self) -> float:
        return self.jump_lambda * (self.jump_mean**2 + self.jump_std**2)

    @property
    def diffusion_sigma(self) -> float:
        """Diffusion vol such that diffusion + jumps ≈ rv_longrun total."""
        var = self.rv_longrun**2 - self.jump_var_annual
        if var <= 0:
            raise ValueError(f"{self.name}: jumps exceed target realized vol")
        return float(np.sqrt(var))


# Jump sizing: single names -> quarterly earnings gaps (4/yr, ~5-9% moves for
# NVDA/TSLA, ~4% AAPL); SPY -> rare macro gaps; crypto -> frequent cascade
# moves (no earnings, but weekend/liquidation jumps).
UNDERLYINGS: Dict[str, UnderlyingSpec] = {
    "SPY": UnderlyingSpec("SPY", 630.0, 0.165, 0.030, 2.0, -0.010, 0.020),
    "AAPL": UnderlyingSpec("AAPL", 230.0, 0.220, 0.040, 4.0, -0.005, 0.040),
    "NVDA": UnderlyingSpec("NVDA", 180.0, 0.445, 0.070, 4.0, -0.005, 0.080),
    "TSLA": UnderlyingSpec("TSLA", 330.0, 0.450, 0.070, 4.0, -0.005, 0.090),
    "ETH": UnderlyingSpec("ETH", 3800.0, 0.500, 0.070, 8.0, -0.010, 0.060, "crypto"),
    "BTC": UnderlyingSpec("BTC", 118000.0, 0.375, 0.050, 6.0, -0.008, 0.050, "crypto"),
}

# Drift scenarios: target EXPECTED simple total return over one year.
DRIFT_SCENARIOS: Dict[str, float] = {
    "bear": -0.20,
    "flat": 0.00,
    "base": 0.08,
    "bull": 0.25,
    "moon": 0.60,
}


# ---------------------------------------------------------------------------
# Monte Carlo: GBM + Merton jumps
# ---------------------------------------------------------------------------


def simulate_paths(
    spec: UnderlyingSpec,
    annual_return: float,
    n_paths: int = 2000,
    n_days: int = 365,
    seed: Optional[int] = None,
    rng: Optional[np.random.Generator] = None,
) -> np.ndarray:
    """Daily (calendar-day) price paths, shape (n_paths, n_days+1).

    Drift is jump-compensated so that E[S_T/S_0] = 1 + annual_return
    regardless of jump calibration.
    """
    rng = rng or np.random.default_rng(seed)
    dt = 1.0 / DAYS_PER_YEAR
    sigma = spec.diffusion_sigma
    lam, mj, sj = spec.jump_lambda, spec.jump_mean, spec.jump_std

    # E[e^J] - 1 for lognormal jumps; compensate drift.
    k_bar = np.exp(mj + 0.5 * sj**2) - 1.0
    mu = np.log1p(annual_return)  # continuous total-growth rate target
    drift = (mu - lam * k_bar - 0.5 * sigma**2) * dt

    z = rng.standard_normal((n_paths, n_days))
    n_jumps = rng.poisson(lam * dt, size=(n_paths, n_days))
    # Sum of n lognormal jumps ~ Normal(n*mj, n*sj^2) in log space.
    jump_log = np.where(
        n_jumps > 0,
        n_jumps * mj + np.sqrt(np.maximum(n_jumps, 0)) * sj * rng.standard_normal(
            (n_paths, n_days)
        ),
        0.0,
    )
    log_ret = drift + sigma * np.sqrt(dt) * z + jump_log
    log_px = np.cumsum(log_ret, axis=1)
    out = np.empty((n_paths, n_days + 1))
    out[:, 0] = spec.spot
    out[:, 1:] = spec.spot * np.exp(log_px)
    return out


# ---------------------------------------------------------------------------
# Implied-vol process
# ---------------------------------------------------------------------------


def iv_paths(
    prices: np.ndarray,
    spec: UnderlyingSpec,
    ewma_lambda: float = 0.94,
    kappa: float = 0.10,
    vol_of_vol: float = 0.006,
    iv_floor: float = 0.05,
    iv_cap: float = 3.0,
    seed: Optional[int] = None,
    rng: Optional[np.random.Generator] = None,
) -> np.ndarray:
    """IV30 quote path for each price path (same shape as ``prices``).

    IV mean-reverts (speed ``kappa`` per day) toward EWMA realized vol + VRP,
    with small vol-of-vol noise. By construction, average IV exceeds average
    subsequently-realized vol by ~spec.vrp: that spread is the covered-call
    seller's structural edge, and it is the ONLY free lunch in the simulator.
    """
    rng = rng or np.random.default_rng(seed)
    prices = np.asarray(prices, dtype=float)
    n_paths, n_cols = prices.shape
    rets = np.diff(np.log(prices), axis=1)

    iv = np.empty_like(prices)
    iv[:, 0] = spec.iv0
    var_ewma = np.full(n_paths, spec.rv_longrun**2 / DAYS_PER_YEAR)  # daily var
    noise = rng.standard_normal((n_paths, n_cols - 1)) * vol_of_vol
    for t in range(1, n_cols):
        var_ewma = ewma_lambda * var_ewma + (1 - ewma_lambda) * rets[:, t - 1] ** 2
        rv_ann = np.sqrt(var_ewma * DAYS_PER_YEAR)
        target = rv_ann + spec.vrp
        iv[:, t] = iv[:, t - 1] + kappa * (target - iv[:, t - 1]) + noise[:, t - 1]
    np.clip(iv, iv_floor, iv_cap, out=iv)
    return iv


# ---------------------------------------------------------------------------
# Historical loader (network required — runs on the user's machine)
# ---------------------------------------------------------------------------

try:  # pragma: no cover - optional dependency, offline in this sandbox
    import yfinance as _yf
except Exception:  # ImportError or anything else at import time
    _yf = None


def load_historical(
    symbol: str,
    start: str = "2015-01-01",
    end: Optional[str] = None,
    interval: str = "1d",
) -> "np.ndarray":
    """Download daily closes via yfinance and return a (1, n_days+1) path
    usable by the engine (crypto symbols e.g. 'ETH-USD', 'BTC-USD').

    NOTE: this sandbox has no market-data network access (yahoo/stooq are
    blocked), so this is a stub that raises a clear error offline. It works
    unmodified on any machine with internet + `pip install yfinance`.
    Historical runs need a matching IV series; absent one, pair the price
    path with ``iv_paths`` using the same underlying spec (the EWMA+VRP model
    then supplies a realistic IV proxy).
    """
    if _yf is None:
        raise RuntimeError(
            "yfinance is not installed or importable. Install it with "
            "`pip install yfinance` and run on a machine with network access "
            "(this backtest sandbox has market-data APIs blocked)."
        )
    df = _yf.download(symbol, start=start, end=end, interval=interval,
                      progress=False, auto_adjust=True)
    if df is None or len(df) == 0:
        raise RuntimeError(f"yfinance returned no data for {symbol!r}")
    closes = np.asarray(df["Close"], dtype=float).reshape(1, -1)
    return closes
