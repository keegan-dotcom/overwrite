"""Venue abstraction.

The strategy engine is venue-agnostic: it sees option chains, positions and
collateral through this interface. `DeriveVenue` implements it against the
Derive orderbook (testnet/mainnet); `MockVenue` implements it against a local
simulator for tests, dry-runs and demos.

Underlyings are referred to by a venue-neutral symbol ("ETH", "BTC", "AAPL",
"TSLA", ...). Each venue maps symbols to its own instrument naming. This is
the seam that makes the agent equities-ready: when Derive lists tokenized
stock options, adding e.g. `AAPL` is a config change, not a code change.
"""
from __future__ import annotations

import abc
import time
from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from typing import Optional


class OptionType(str, Enum):
    CALL = "C"
    PUT = "P"


class Side(str, Enum):
    BUY = "buy"
    SELL = "sell"


class OrderState(str, Enum):
    OPEN = "open"
    FILLED = "filled"
    PARTIAL = "partial"
    CANCELLED = "cancelled"
    REJECTED = "rejected"


@dataclass(frozen=True)
class OptionQuote:
    """A single option instrument with a live quote."""

    instrument_name: str
    underlying: str
    expiry_ts: int                     # unix seconds
    strike: Decimal
    option_type: OptionType
    bid: Optional[Decimal]             # None = empty book side
    ask: Optional[Decimal]
    mark: Decimal
    delta: Decimal
    iv: Decimal                        # mark implied vol, e.g. 0.45
    open_interest: Decimal = Decimal(0)
    min_amount: Decimal = Decimal("0.1")
    amount_step: Decimal = Decimal("0.1")
    tick_size: Decimal = Decimal("0.1")
    timestamp: float = field(default_factory=time.time)

    @property
    def mid(self) -> Optional[Decimal]:
        if self.bid is None or self.ask is None:
            return None
        return (self.bid + self.ask) / 2

    @property
    def spread_pct(self) -> Optional[Decimal]:
        m = self.mid
        if m is None or m == 0:
            return None
        return (self.ask - self.bid) / m

    def dte(self, now_ts: Optional[float] = None) -> float:
        now_ts = time.time() if now_ts is None else now_ts
        return max(0.0, (self.expiry_ts - now_ts) / 86400.0)


@dataclass(frozen=True)
class Position:
    instrument_name: str
    amount: Decimal                    # negative = short
    average_price: Decimal
    mark_price: Decimal
    delta: Decimal = Decimal(0)
    unrealized_pnl: Decimal = Decimal(0)


@dataclass(frozen=True)
class Balance:
    asset: str
    amount: Decimal
    mark_value_usd: Decimal = Decimal(0)


@dataclass(frozen=True)
class MarginSummary:
    """Subaccount-level margin picture (quote currency terms)."""

    total_value: Decimal
    initial_margin: Decimal
    maintenance_margin: Decimal

    @property
    def maintenance_usage(self) -> Decimal:
        if self.total_value <= 0:
            return Decimal(1)
        return self.maintenance_margin / self.total_value


@dataclass(frozen=True)
class OrderResult:
    order_id: str
    state: OrderState
    filled_amount: Decimal = Decimal(0)
    average_fill_price: Decimal = Decimal(0)


class Venue(abc.ABC):
    """Everything the strategy needs from an exchange."""

    name: str = "venue"

    @abc.abstractmethod
    def spot(self, underlying: str) -> Decimal:
        """Index/spot price of the underlying in quote currency."""

    @abc.abstractmethod
    def option_chain(self, underlying: str) -> list[OptionQuote]:
        """All live, unexpired option quotes for the underlying."""

    @abc.abstractmethod
    def positions(self) -> list[Position]:
        """Open option positions (options only)."""

    @abc.abstractmethod
    def balances(self) -> list[Balance]:
        """ERC-20 collateral balances in the subaccount."""

    @abc.abstractmethod
    def margin(self) -> MarginSummary:
        """Current margin summary."""

    @abc.abstractmethod
    def place_limit(
        self,
        instrument_name: str,
        side: Side,
        amount: Decimal,
        limit_price: Decimal,
        label: str = "",
        post_only: bool = False,
        reduce_only: bool = False,
    ) -> OrderResult:
        """Place a limit order. Market orders are deliberately unsupported."""

    @abc.abstractmethod
    def order_status(self, instrument_name: str, order_id: str) -> OrderResult:
        ...

    @abc.abstractmethod
    def cancel(self, instrument_name: str, order_id: str) -> None:
        ...

    @abc.abstractmethod
    def cancel_all(self) -> None:
        ...

    def now(self) -> float:
        """Venue clock (overridable by simulators)."""
        return time.time()

    def collateral_assets(self, underlying: str) -> tuple[str, ...]:
        """Balance asset names that count as cover for `underlying`.

        Exact names only - callers must match with equality, never prefixes
        (prefix matching lets e.g. 'ETHENA' count as ETH cover). Venues with
        wrapped-collateral naming (WETH/WBTC on Derive) override this.
        """
        return (underlying,)
