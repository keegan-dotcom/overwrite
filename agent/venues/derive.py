"""Derive venue adapter.

Wraps the community `derive_client` HTTPClient (which in turn uses Derive's
official action-signing) and maps Derive schemas onto the venue-neutral
interface in `base.py`.

Environment:  test -> api-demo.lyra.finance / Derive testnet
              prod -> api.lyra.finance     / Derive Chain (chain id 957)

Symbol mapping: `configs/config.example.yaml` maps venue-neutral symbols to
Derive currencies. Today that's ETH->ETH, BTC->BTC. When Derive lists
tokenized-stock options (v3 / RWA expansion), add e.g. AAPL->AAPLx here and
in YAML - no strategy code changes.

NOTE ON NETWORK SANDBOXES: this module imports derive_client lazily so the
rest of the agent (mock venue, tests, backtests) works in offline sandboxes.
"""
from __future__ import annotations

import time
from decimal import Decimal
from typing import Optional

from ..config import DeriveConfig
from .base import (
    Balance,
    MarginSummary,
    OptionQuote,
    OptionType,
    OrderResult,
    OrderState,
    Position,
    Side,
    Venue,
)

# venue-neutral symbol -> Derive currency code
DEFAULT_SYMBOL_MAP: dict[str, str] = {
    "ETH": "ETH",
    "BTC": "BTC",
    "SOL": "SOL",
    "XAUT": "XAUT",
    # -- equities: uncomment as Derive lists them (names TBC at listing) -----
    # "AAPL": "AAPLX",
    # "NVDA": "NVDAX",
    # "TSLA": "TSLAX",
    # "SPY":  "SPYX",
}

# venue-neutral symbol -> exact collateral asset names that count as cover.
# Derive collateral for a currency can be a wrapped/staked variant; exact
# names only (never prefixes). Extend as variants are verified on testnet.
DEFAULT_COLLATERAL_MAP: dict[str, tuple[str, ...]] = {
    "ETH": ("ETH", "WETH"),
    "BTC": ("BTC", "WBTC"),
}

_STATE_MAP = {
    "open": OrderState.OPEN,
    "filled": OrderState.FILLED,
    "cancelled": OrderState.CANCELLED,
    "expired": OrderState.CANCELLED,
    "rejected": OrderState.REJECTED,
}


def _to_dec(v, default: str = "0") -> Decimal:
    """Decimal conversion that tolerates None, msgspec UNSET sentinels, and
    any other non-numeric junk the API hands back. Fails to `default`."""
    if v is None:
        return Decimal(default)
    try:
        return Decimal(str(v))
    except Exception:
        return Decimal(default)


def _opt_dec(v) -> Optional[Decimal]:
    """Like _to_dec but returns None for absent/invalid/non-positive values -
    used for bid/ask where 'no price' must stay None, never 0."""
    if v is None:
        return None
    try:
        d = Decimal(str(v))
    except Exception:
        return None
    return d if d > 0 else None


class DeriveVenue(Venue):
    name = "derive"

    def __init__(
        self,
        cfg: DeriveConfig,
        symbol_map: Optional[dict[str, str]] = None,
    ) -> None:
        from derive_client import HTTPClient  # lazy: offline-sandbox friendly
        from derive_client.data_types import Environment

        env = Environment.TEST if cfg.environment == "test" else Environment.PROD
        self._cfg = cfg
        self._symbols = dict(symbol_map or DEFAULT_SYMBOL_MAP)
        self._client = HTTPClient(
            wallet=cfg.wallet,
            session_key=cfg.session_key,
            subaccount_id=cfg.subaccount_id,
            env=env,
        )
        self._client.connect()
        # HTTPClient has no `.subaccounts` mapping; `active_subaccount` fetches
        # and caches the Subaccount bound to cfg.subaccount_id (validated by
        # connect()). Its .refresh().state carries margin/value fields.
        self._sub = self._client.active_subaccount

    # -- helpers -------------------------------------------------------------

    def _currency(self, underlying: str) -> str:
        try:
            return self._symbols[underlying]
        except KeyError:
            raise KeyError(
                f"underlying {underlying!r} has no Derive mapping; "
                f"known: {sorted(self._symbols)}"
            )

    def collateral_assets(self, underlying: str) -> tuple[str, ...]:
        return DEFAULT_COLLATERAL_MAP.get(
            underlying, (self._currency(underlying),)
        )

    # -- venue interface --------------------------------------------------------

    def spot(self, underlying: str) -> Decimal:
        cur = self._client.markets.get_currency(currency=self._currency(underlying))
        for field in ("spot_price", "spot_price_24h", "index_price"):
            px = _opt_dec(getattr(cur, field, None))
            if px is not None:
                return px
        raise ValueError(f"no usable spot price for {underlying}")

    def option_chain(self, underlying: str) -> list[OptionQuote]:
        from derive_client.data_types.generated_models import InstrumentType

        currency = self._currency(underlying)
        spot = self.spot(underlying)
        instruments = self._client.markets.get_instruments(
            currency=currency, expired=False, instrument_type=InstrumentType.option
        )
        now = time.time()

        def _worth_quoting(name: str) -> bool:
            """Pre-filter BEFORE the per-instrument ticker call (which is the
            expensive part - hundreds of serial HTTP calls otherwise).
            Calls only; expiry <= 100d; strike within [0.5x, 2.5x] spot.
            Wide bounds on purpose: held positions must stay quotable for
            management even after big spot moves. Unparseable names are kept
            (fail open)."""
            try:
                _cur, day, strike_s, ot = name.split("-")
                if ot != "C":
                    return False
                import calendar as _cal
                exp = _cal.timegm(time.strptime(day, "%Y%m%d")) + 8 * 3600
                if (exp - now) / 86400 > 100:
                    return False
                k = Decimal(strike_s)
                return spot * Decimal("0.5") <= k <= spot * Decimal("2.5")
            except Exception:
                return True

        out: list[OptionQuote] = []
        for inst in instruments:
            name = inst.instrument_name
            if not _worth_quoting(name):
                continue
            try:
                t = self._client.markets.get_ticker(instrument_name=name)
            except Exception:
                continue
            od = t.option_details
            op = t.option_pricing
            if od is None or op is None:
                continue
            out.append(
                OptionQuote(
                    instrument_name=name,
                    underlying=underlying,
                    expiry_ts=int(od.expiry),
                    strike=_to_dec(od.strike),
                    option_type=(
                        OptionType.CALL
                        if str(od.option_type).upper().endswith("C")
                        else OptionType.PUT
                    ),
                    bid=_opt_dec(t.best_bid_price),
                    ask=_opt_dec(t.best_ask_price),
                    mark=_to_dec(t.mark_price),
                    delta=_to_dec(op.delta),
                    iv=_to_dec(op.iv),
                    open_interest=_to_dec(t.open_interest),
                    min_amount=_to_dec(t.minimum_amount, "0.1"),
                    amount_step=_to_dec(t.amount_step, "0.1"),
                    tick_size=_to_dec(t.tick_size, "0.1"),
                    timestamp=now,
                )
            )
        return out

    def positions(self) -> list[Position]:
        out = []
        for p in self._client.positions.list(is_open=True):
            if str(getattr(p, "instrument_type", "")) not in ("option", "InstrumentType.option"):
                continue
            out.append(
                Position(
                    instrument_name=p.instrument_name,
                    amount=_to_dec(p.amount),
                    average_price=_to_dec(p.average_price),
                    mark_price=_to_dec(p.mark_price),
                    delta=_to_dec(p.delta),
                    unrealized_pnl=_to_dec(p.unrealized_pnl),
                )
            )
        return out

    def balances(self) -> list[Balance]:
        res = self._client.collateral.get()
        out = []
        for c in res.collaterals:
            out.append(
                Balance(
                    asset=c.asset_name,
                    amount=_to_dec(c.amount),
                    mark_value_usd=_to_dec(c.mark_value),
                )
            )
        return out

    def margin(self) -> MarginSummary:
        # Derive's private/get_subaccount reports initial_margin /
        # maintenance_margin as AVAILABLE HEADROOM (equity minus requirement),
        # not the requirement itself. Confirmed on live testnet 2026-07-30:
        # subaccount_value ~= 100,073 with maintenance_margin ~= 100,058 on a
        # near-empty book. MarginSummary wants the REQUIREMENT, so convert:
        #     requirement = subaccount_value - available   (clamped >= 0)
        st = self._sub.refresh().state
        value = _to_dec(st.subaccount_value)
        im_avail = _to_dec(st.initial_margin)
        mm_avail = _to_dec(st.maintenance_margin)
        zero = Decimal(0)
        return MarginSummary(
            total_value=value,
            initial_margin=max(zero, value - im_avail),
            maintenance_margin=max(zero, value - mm_avail),
        )

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
        from derive_client.data_types.generated_models import (
            Direction,
            OrderType,
            TimeInForce,
        )

        res = self._client.orders.create(
            amount=amount,
            direction=Direction.sell if side == Side.SELL else Direction.buy,
            instrument_name=instrument_name,
            limit_price=limit_price,
            label=label[:32],
            order_type=OrderType.limit,
            time_in_force=TimeInForce.post_only if post_only else TimeInForce.gtc,
            reduce_only=reduce_only,
            extra_fee=self._cfg.extra_fee,   # builder-code revenue hook
        )
        return self._order_result(res)

    def order_status(self, instrument_name: str, order_id: str) -> OrderResult:
        res = self._client.orders.get(order_id=order_id)
        order = getattr(res, "order", res)
        return self._order_result(order)

    @staticmethod
    def _order_result(o) -> OrderResult:
        status = str(getattr(o, "order_status", getattr(o, "status", "open"))).lower()
        # msgspec enums stringify like 'OrderStatus.filled'
        status = status.split(".")[-1]
        filled = _to_dec(getattr(o, "filled_amount", 0))
        avg = _to_dec(getattr(o, "average_price", 0))
        state = _STATE_MAP.get(status, OrderState.OPEN)
        if state == OrderState.OPEN and filled > 0:
            state = OrderState.PARTIAL
        return OrderResult(
            order_id=str(getattr(o, "order_id", "")),
            state=state,
            filled_amount=filled,
            average_fill_price=avg,
        )

    def cancel(self, instrument_name: str, order_id: str) -> None:
        self._client.orders.cancel(instrument_name=instrument_name, order_id=order_id)

    def cancel_all(self) -> None:
        self._client.orders.cancel_all()
