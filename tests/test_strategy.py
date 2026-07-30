"""Strategy engine tests: selection, management rules, covered invariant."""
import time
from decimal import Decimal

import pytest

from agent.config import UnderlyingConfig
from agent.strategy.covered_call import (
    IntentKind,
    Snapshot,
    decide,
    find_credit_deriser,
    select_call_to_sell,
)
from agent.venues.base import OptionQuote, OptionType, Position

D = Decimal
NOW = 1_800_000_000.0


def q(
    strike, delta, bid, ask, dte=35, ot=OptionType.CALL, name=None, iv="0.5", oi=100
):
    return OptionQuote(
        instrument_name=name or f"ETH-X-{strike}-{ot.value}",
        underlying="ETH",
        expiry_ts=int(NOW + dte * 86400),
        strike=D(str(strike)),
        option_type=ot,
        bid=D(str(bid)) if bid is not None else None,
        ask=D(str(ask)) if ask is not None else None,
        mark=(D(str(bid)) + D(str(ask))) / 2 if bid is not None and ask is not None else D("1"),
        delta=D(str(delta)),
        iv=D(iv),
        open_interest=D(oi),
        timestamp=NOW,
    )


def snap(chain, shorts=(), held="10", spot="3800"):
    return Snapshot(
        underlying="ETH", spot=D(spot), chain=list(chain),
        short_calls=list(shorts), held_units=D(held), now_ts=NOW,
    )


def cfg(**kw):
    return UnderlyingConfig(symbol="ETH", **kw)


class TestSelection:
    def test_picks_nearest_to_delta_target(self):
        chain = [q(4200, "0.30", 80, 90), q(4400, "0.22", 55, 62), q(4600, "0.15", 30, 34)]
        best = select_call_to_sell(snap(chain), cfg(delta_target=D("0.22")))
        assert best.strike == D("4400")

    def test_respects_delta_band(self):
        chain = [q(4000, "0.55", 200, 210), q(5200, "0.05", 5, 6)]
        assert select_call_to_sell(snap(chain), cfg()) is None

    def test_respects_dte_band(self):
        chain = [q(4400, "0.25", 55, 62, dte=5), q(4400, "0.25", 90, 99, dte=90)]
        assert select_call_to_sell(snap(chain), cfg()) is None

    def test_skips_wide_spreads(self):
        chain = [q(4400, "0.25", 40, 80)]  # 66% spread
        assert select_call_to_sell(snap(chain), cfg()) is None

    def test_skips_empty_book(self):
        chain = [q(4400, "0.25", None, None)]
        assert select_call_to_sell(snap(chain), cfg()) is None

    def test_min_yield_filter(self):
        # bid 10 on 3800 spot over 35d = ~2.7% annualized < 6% floor
        chain = [q(4400, "0.25", 10, 11)]
        assert select_call_to_sell(snap(chain), cfg()) is None

    def test_puts_never_selected(self):
        chain = [q(3400, "-0.25", 60, 66, ot=OptionType.PUT)]
        assert select_call_to_sell(snap(chain), cfg()) is None


class TestCoverage:
    def test_never_sells_more_than_held(self):
        chain = [q(4400, "0.25", 55, 62)]
        s = snap(chain, held="2")
        intents = decide(s, cfg(max_order=D("50")))
        sells = [i for i in intents if i.kind == IntentKind.SELL_CALL]
        assert len(sells) == 1
        assert sells[0].amount <= D("2")

    def test_capacity_reduced_by_existing_shorts(self):
        chain = [q(4400, "0.25", 55, 62)]
        shorts = [Position("ETH-X-4500-C", D("-8"), D("50"), D("40"), D("0.2"))]
        intents = decide(snap(chain, shorts, held="10"), cfg(max_order=D("50")))
        sells = [i for i in intents if i.kind == IntentKind.SELL_CALL]
        # 10 * 0.9 util - 8 = 1.0
        assert sells and sells[0].amount == D("1.0")

    def test_no_sell_when_fully_covered(self):
        chain = [q(4400, "0.25", 55, 62)]
        shorts = [Position("ETH-X-4500-C", D("-9"), D("50"), D("40"), D("0.2"))]
        intents = decide(snap(chain, shorts, held="10"), cfg())
        assert not [i for i in intents if i.kind == IntentKind.SELL_CALL]


class TestManagement:
    def test_take_profit(self):
        held = q(4400, "0.10", 12, 14, name="ETH-HELD-4400-C")
        shorts = [Position("ETH-HELD-4400-C", D("-1"), D("60"), D("13"), D("0.1"))]
        intents = decide(snap([held], shorts), cfg())
        bb = [i for i in intents if i.kind == IntentKind.BUY_BACK]
        assert bb and "take-profit" in bb[0].reason

    def test_roll_at_dte(self):
        held = q(4400, "0.25", 40, 44, dte=15, name="ETH-HELD-4400-C")
        shorts = [Position("ETH-HELD-4400-C", D("-1"), D("60"), D("42"), D("0.25"))]
        intents = decide(snap([held], shorts), cfg())
        bb = [i for i in intents if i.kind == IntentKind.BUY_BACK]
        assert bb and "roll" in bb[0].reason

    def test_defensive_roll_requires_credit_and_derisk(self):
        held = q(3900, "0.70", 180, 190, name="ETH-HELD-3900-C")
        # replacement: higher strike, longer dte, bid >= 190 (net credit), lower delta
        repl = q(4300, "0.45", 195, 205, dte=50, name="ETH-REPL-4300-C")
        shorts = [Position("ETH-HELD-3900-C", D("-1"), D("60"), D("185"), D("0.70"))]
        intents = decide(snap([held, repl], shorts), cfg())
        bb = [i for i in intents if i.kind == IntentKind.BUY_BACK]
        assert bb and bb[0].replacement is not None
        assert bb[0].replacement.instrument_name == "ETH-REPL-4300-C"

    def test_defensive_hold_when_no_credit_roll(self):
        held = q(3900, "0.70", 180, 190, name="ETH-HELD-3900-C")
        # only replacement available is a debit (bid < 190)
        repl = q(4300, "0.45", 120, 130, dte=50, name="ETH-REPL-4300-C")
        shorts = [Position("ETH-HELD-3900-C", D("-1"), D("60"), D("185"), D("0.70"))]
        intents = decide(snap([held, repl], shorts), cfg())
        assert not [i for i in intents if i.kind == IntentKind.BUY_BACK]

    def test_derisk_guard_rejects_same_delta_roll(self):
        held = q(3900, "0.70", 180, 190, name="ETH-HELD-3900-C")
        repl = q(3950, "0.65", 195, 205, dte=50, name="ETH-REPL-3950-C")
        s = snap([held, repl])
        pos = Position("ETH-HELD-3900-C", D("-1"), D("60"), D("185"), D("0.70"))
        assert find_credit_deriser(s, cfg(), pos, held) is None

    def test_reopens_after_buyback_same_cycle_respects_coverage(self):
        # 1 held unit; short being rolled frees capacity for the new sell
        held = q(4400, "0.25", 40, 44, dte=15, name="ETH-HELD-4400-C")
        fresh = q(4500, "0.25", 55, 62, dte=35, name="ETH-FRESH-4500-C")
        shorts = [Position("ETH-HELD-4400-C", D("-1"), D("60"), D("42"), D("0.25"))]
        intents = decide(snap([held, fresh], shorts, held="1"), cfg(min_order=D("1"), max_utilization=D("1")))
        kinds = [i.kind for i in intents]
        assert kinds.count(IntentKind.BUY_BACK) == 1
        assert kinds.count(IntentKind.SELL_CALL) == 1
