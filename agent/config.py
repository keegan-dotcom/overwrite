"""Configuration loading and validation.

All strategy parameters live in YAML (see configs/config.example.yaml);
secrets live in the environment / .env. Nothing secret ever goes in YAML.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path

import yaml


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class UnderlyingConfig:
    symbol: str                       # venue-neutral: ETH, BTC, AAPL, ...
    enabled: bool = True
    # sizing
    max_utilization: Decimal = Decimal("0.90")   # fraction of held units we overwrite
    min_order: Decimal = Decimal("0.1")          # min contracts per order
    max_order: Decimal = Decimal("10")           # max contracts per single order
    # selection
    delta_target: Decimal = Decimal("0.25")
    delta_min: Decimal = Decimal("0.12")
    delta_max: Decimal = Decimal("0.35")
    dte_target: int = 35
    dte_min: int = 25            # must be > roll_dte or you sell-then-roll churn
    dte_max: int = 60
    min_annualized_yield: Decimal = Decimal("0.05")  # skip if premium too thin
    max_spread_pct: Decimal = Decimal("0.15")        # skip illiquid quotes
    min_open_interest: Decimal = Decimal("0")        # 0 = don't filter (testnet)
    # management
    roll_dte: int = 21
    take_profit_pct: Decimal = Decimal("0.75")       # buy back after 75% decay
    defensive_delta: Decimal = Decimal("0.60")       # attempt credit-only roll above
    defensive_delta_improvement: Decimal = Decimal("0.10")  # roll must de-risk by this

    def validate(self) -> None:
        if not (0 < self.delta_min <= self.delta_target <= self.delta_max < 1):
            raise ConfigError(f"{self.symbol}: delta band invalid")
        if not (0 < self.dte_min <= self.dte_target <= self.dte_max):
            raise ConfigError(f"{self.symbol}: dte band invalid")
        if self.roll_dte >= self.dte_max:
            raise ConfigError(f"{self.symbol}: roll_dte must be < dte_max")
        if self.roll_dte >= self.dte_min:
            raise ConfigError(
                f"{self.symbol}: roll_dte ({self.roll_dte}) must be < dte_min "
                f"({self.dte_min}) - otherwise fresh sells are immediately rolled"
            )
        if not (0 < self.max_utilization <= 1):
            raise ConfigError(f"{self.symbol}: max_utilization must be in (0,1]")
        if not (0 < self.take_profit_pct < 1):
            raise ConfigError(f"{self.symbol}: take_profit_pct must be in (0,1)")


@dataclass(frozen=True)
class RiskConfig:
    max_maintenance_usage: Decimal = Decimal("0.40")  # no new risk above this
    max_orders_per_day: int = 60
    max_price_dev_from_mark: Decimal = Decimal("0.25")  # limit px within 25% of mark
    max_quote_age_sec: float = 90.0
    kill_switch_file: str = "data/KILL"
    pause_file: str = "data/PAUSE"
    max_drawdown_pause: Decimal = Decimal("0.15")     # pause new sells at -15% equity


@dataclass(frozen=True)
class ExecutionConfig:
    fill_timeout_sec: float = 45.0
    max_reprices: int = 3
    # first order at mid minus aggression*spread (selling); walks toward bid
    aggression: Decimal = Decimal("0.25")
    post_only: bool = True
    # maker mode: when the book is empty/one-sided, quote a resting post-only
    # order at MARK instead of requiring an existing bid. Resting orders are
    # cancelled and re-quoted at fresh mark each cycle. Essential on quiet
    # venues (testnet); on mainnet it earns the spread instead of paying it.
    maker_mode: bool = False


@dataclass(frozen=True)
class DeriveConfig:
    environment: str = "test"          # test | prod
    wallet: str = ""                   # from env DERIVE_WALLET
    session_key: str = ""              # from env DERIVE_SESSION_KEY (private key)
    subaccount_id: int = 0             # from env DERIVE_SUBACCOUNT_ID
    extra_fee: Decimal = Decimal("0")  # builder-code fee per trade (USDC)


@dataclass(frozen=True)
class AgentConfig:
    venue: str = "mock"                # mock | derive
    quote_asset: str = "USDC"
    cycle_seconds: int = 900
    state_db: str = "data/overwrite.db"
    log_dir: str = "data/logs"
    dry_run: bool = True               # SAFE DEFAULT: no orders unless flipped
    underlyings: tuple[UnderlyingConfig, ...] = ()
    risk: RiskConfig = field(default_factory=RiskConfig)
    execution: ExecutionConfig = field(default_factory=ExecutionConfig)
    derive: DeriveConfig = field(default_factory=DeriveConfig)

    def validate(self) -> None:
        if self.venue not in ("mock", "derive"):
            raise ConfigError(f"unknown venue {self.venue!r}")
        if not self.underlyings:
            raise ConfigError("no underlyings configured")
        seen: set[str] = set()
        for u in self.underlyings:
            if u.symbol in seen:
                raise ConfigError(f"duplicate underlying {u.symbol}")
            seen.add(u.symbol)
            u.validate()
        if self.venue == "derive" and not self.dry_run:
            d = self.derive
            if not (d.wallet and d.session_key and d.subaccount_id):
                raise ConfigError(
                    "live Derive trading requires DERIVE_WALLET, "
                    "DERIVE_SESSION_KEY and DERIVE_SUBACCOUNT_ID"
                )


def _dec(v) -> Decimal:
    return Decimal(str(v))


_DEC_FIELDS_U = {
    "max_utilization", "min_order", "max_order", "delta_target", "delta_min",
    "delta_max", "min_annualized_yield", "max_spread_pct", "min_open_interest",
    "take_profit_pct", "defensive_delta", "defensive_delta_improvement",
}
_DEC_FIELDS_R = {"max_maintenance_usage", "max_price_dev_from_mark", "max_drawdown_pause"}


def load_config(path: str | Path) -> AgentConfig:
    raw = yaml.safe_load(Path(path).read_text()) or {}

    unders = []
    for u in raw.get("underlyings", []):
        kw = dict(u)
        for k in list(kw):
            if k in _DEC_FIELDS_U:
                kw[k] = _dec(kw[k])
        unders.append(UnderlyingConfig(**kw))

    risk_raw = dict(raw.get("risk", {}))
    for k in list(risk_raw):
        if k in _DEC_FIELDS_R:
            risk_raw[k] = _dec(risk_raw[k])
    exec_raw = dict(raw.get("execution", {}))
    if "aggression" in exec_raw:
        exec_raw["aggression"] = _dec(exec_raw["aggression"])

    derive_raw = dict(raw.get("derive", {}))
    derive_raw.setdefault("environment", "test")
    if "extra_fee" in derive_raw:
        derive_raw["extra_fee"] = _dec(derive_raw["extra_fee"])
    # secrets come from env, never YAML
    derive_raw["wallet"] = os.environ.get("DERIVE_WALLET", "")
    derive_raw["session_key"] = os.environ.get("DERIVE_SESSION_KEY", "")
    derive_raw["subaccount_id"] = int(os.environ.get("DERIVE_SUBACCOUNT_ID", "0") or 0)

    cfg = AgentConfig(
        venue=raw.get("venue", "mock"),
        quote_asset=raw.get("quote_asset", "USDC"),
        cycle_seconds=int(raw.get("cycle_seconds", 900)),
        state_db=raw.get("state_db", "data/overwrite.db"),
        log_dir=raw.get("log_dir", "data/logs"),
        dry_run=bool(raw.get("dry_run", True)),
        underlyings=tuple(unders),
        risk=RiskConfig(**risk_raw),
        execution=ExecutionConfig(**exec_raw),
        derive=DeriveConfig(**derive_raw),
    )
    cfg.validate()
    return cfg
