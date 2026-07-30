"""Overwrite backtest package.

Event-driven covered-call simulator + Monte Carlo path generation used to
validate (or refute) the "~10% annualized yield from systematically selling
covered calls" claim across the Overwrite underlying set
(ETH, BTC today; AAPL, NVDA, TSLA, SPY when tokenized-stock options list).

Modules
-------
engine   : Black-Scholes pricing + vectorized covered-call engine.
paths    : Monte Carlo (GBM + Merton jumps) path generation, IV process,
           per-underlying calibration, and an optional yfinance historical
           loader (network required; runs on the user's machine, not in CI).
run_validation : full validation grid -> results/validation.{json,md} + charts.
"""

from . import engine, paths

__all__ = ["engine", "paths"]
