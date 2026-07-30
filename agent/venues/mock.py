"""Mock venue: a deterministic single-process options exchange simulator.

Purpose: unit tests, `--venue mock` demo runs, and CI. Generates a
Black-Scholes chain around a controllable spot with a configurable IV, fills
limit orders that cross the synthetic book, tracks positions/collateral, and
cash-settles expiries European-style (Derive semantics).
"""
from __future__ import annotations

import itertools
import time
from decimal import Decimal
from typing import Optional

from ..strategy import greeks
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

_D = Decimal


def _dec(x: float, q: str = "0.0001") -> Decimal:
    return _D(str(x)).quantize(_D(q))


class MockVenue(Venue):
    name = "mock"

    def __init__(
        self,
        spots: dict[str, Decimal],
        ivs: dict[str, Decimal],
        holdings: dict[str, Decimal],
        usdc: Decimal = _D("10000"),
        spread_pct: Decimal = _D("0.06"),
        now_ts: Optional[float] = None,
        expiries_dte: tuple[int, ...] = (7, 14, 28, 35, 49, 63),
        n_strikes: int = 13,
    ) -> None:
        self._spots = dict(spots)
        self._ivs = dict(ivs)
        self._holdings = dict(holdings)
        self._usdc = usdc
        self._spread = spread_pct
        self._now = now_ts if now_ts is not None else time.time()
        self._expiries_dte = expiries_dte
        self._n_strikes = n_strikes
        self._positions: dict[str, dict] = {}  # name -> {amount, avg_price}
        self._orders: dict[str, OrderResult] = {}
        self._oid = itertools.count(1)
        self.fills: list[dict] = []            # audit trail for tests

    # -- clock control (tests) -------------------------------------------------

    def now(self) -> float:
        return self._now

    def advance(self, days: float, new_spots: Optional[dict[str, Decimal]] = None):
        self._now += days * 86400
        if new_spots:
            self._spots.update(new_spots)
        self._settle_expired()

    def set_iv(self, underlying: str, iv: Decimal) -> None:
        self._ivs[underlying] = iv

    # -- venue interface ---------------------------------------------------------

    def spot(self, underlying: str) -> Decimal:
        return self._spots[underlying]

    def option_chain(self, underlying: str) -> list[OptionQuote]:
        s = float(self._spots[underlying])
        iv = float(self._ivs[underlying])
        chain: list[OptionQuote] = []
        for dte in self._expiries_dte:
            expiry_ts = int(self._now + dte * 86400)
            t = dte / 365.0
            # strikes: spot*0.85 .. spot*1.6, denser near the money
            for i in range(self._n_strikes):
                k = s * (0.85 + 0.0625 * i)
                strike = _dec(round(k, 2), "0.01")
                for ot in (OptionType.CALL, OptionType.PUT):
                    if ot == OptionType.CALL:
                        px = greeks.call_price(s, float(strike), iv, t)
                        delta = greeks.call_delta(s, float(strike), iv, t)
                    else:
                        px = greeks.put_price(s, float(strike), iv, t)
                        delta = greeks.call_delta(s, float(strike), iv, t) - 1.0
                    mark = _dec(max(px, 0.0001))
                    half = mark * self._spread / 2
                    name = self._name(underlying, expiry_ts, strike, ot)
                    chain.append(
                        OptionQuote(
                            instrument_name=name,
                            underlying=underlying,
                            expiry_ts=expiry_ts,
                            strike=strike,
                            option_type=ot,
                            bid=max(mark - half, _D("0.0001")),
                            ask=mark + half,
                            mark=mark,
                            delta=_dec(delta),
                            iv=_D(str(iv)),
                            open_interest=_D(100),
                            timestamp=self._now,
                        )
                    )
        return chain

    @staticmethod
    def _name(u: str, expiry_ts: int, strike: Decimal, ot: OptionType) -> str:
        day = time.strftime("%Y%m%d", time.gmtime(expiry_ts))
        return f"{u}-{day}-{int(strike)}-{ot.value}"

    def positions(self) -> list[Position]:
        out = []
        for name, p in self._positions.items():
            if p["amount"] == 0:
                continue
            q = self._quote_by_name(name)
            mark = q.mark if q else _D(0)
            delta = q.delta if q else _D(0)
            out.append(
                Position(
                    instrument_name=name,
                    amount=p["amount"],
                    average_price=p["avg_price"],
                    mark_price=mark,
                    delta=delta,
                )
            )
        return out

    def _quote_by_name(self, name: str) -> Optional[OptionQuote]:
        u = name.split("-")[0]
        if u not in self._spots:
            return None
        for q in self.option_chain(u):
            if q.instrument_name == name:
                return q
        return None

    def balances(self) -> list[Balance]:
        out = [Balance("USDC", self._usdc, self._usdc)]
        for u, amt in self._holdings.items():
            out.append(Balance(u, amt, amt * self._spots[u]))
        return out

    def margin(self) -> MarginSummary:
        tv = self._usdc + sum(
            amt * self._spots[u] for u, amt in self._holdings.items()
        )
        # crude: maintenance = 10% of short option notional (covered => low)
        mm = _D(0)
        for name, p in self._positions.items():
            if p["amount"] < 0:
                q = self._quote_by_name(name)
                if q:
                    mm += -p["amount"] * self._spots[q.underlying] * _D("0.03")
        return MarginSummary(total_value=tv, initial_margin=mm * 2, maintenance_margin=mm)

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
        assert amount > 0
        q = self._quote_by_name(instrument_name)
        oid = str(next(self._oid))
        if q is None:
            res = OrderResult(oid, OrderState.REJECTED)
            self._orders[oid] = res
            return res
        crosses = (
            (side == Side.SELL and q.bid is not None and limit_price <= q.bid)
            or (side == Side.BUY and q.ask is not None and limit_price >= q.ask)
        )
        if not crosses:
            res = OrderResult(oid, OrderState.OPEN)
            self._orders[oid] = res
            return res
        fill_px = q.bid if side == Side.SELL else q.ask
        signed = -amount if side == Side.SELL else amount
        p = self._positions.setdefault(
            instrument_name, {"amount": _D(0), "avg_price": _D(0)}
        )
        old = p["amount"]
        new = old + signed
        if (old <= 0 and signed < 0) or (old >= 0 and signed > 0):
            # increasing exposure: blend average
            tot = abs(old) + abs(signed)
            p["avg_price"] = (
                (p["avg_price"] * abs(old) + fill_px * abs(signed)) / tot
                if tot
                else _D(0)
            )
        p["amount"] = new
        self._usdc += fill_px * amount if side == Side.SELL else -fill_px * amount
        self.fills.append(
            {"instrument": instrument_name, "side": side.value,
             "amount": amount, "price": fill_px, "label": label}
        )
        res = OrderResult(oid, OrderState.FILLED, amount, fill_px)
        self._orders[oid] = res
        return res

    def order_status(self, instrument_name: str, order_id: str) -> OrderResult:
        return self._orders[order_id]

    def cancel(self, instrument_name: str, order_id: str) -> None:
        r = self._orders.get(order_id)
        if r and r.state == OrderState.OPEN:
            self._orders[order_id] = OrderResult(order_id, OrderState.CANCELLED)

    def cancel_all(self) -> None:
        for oid, r in list(self._orders.items()):
            if r.state == OrderState.OPEN:
                self._orders[oid] = OrderResult(oid, OrderState.CANCELLED)

    # -- settlement ---------------------------------------------------------------

    def _settle_expired(self) -> None:
        for name, p in list(self._positions.items()):
            if p["amount"] == 0:
                continue
            u, day, strike_s, ot = name.split("-")
            expiry_ts = time.mktime(time.strptime(day + "1200UTC", "%Y%m%d%H%M%Z"))
            if expiry_ts > self._now:
                continue
            spot = self._spots[u]
            strike = _D(strike_s)
            if ot == "C":
                intrinsic = max(spot - strike, _D(0))
            else:
                intrinsic = max(strike - spot, _D(0))
            # cash settlement: short pays intrinsic, long receives
            self._usdc += p["amount"] * intrinsic
            self.fills.append(
                {"instrument": name, "side": "settlement",
                 "amount": p["amount"], "price": intrinsic, "label": "expiry"}
            )
            p["amount"] = _D(0)
