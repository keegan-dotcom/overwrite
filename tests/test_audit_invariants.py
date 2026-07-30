"""Adversarial audit tests: covered invariant, symbol matching, decide() edges.

Written during the pre-trading audit. Each test encodes a way the agent could
have sold uncovered calls, traded the wrong asset, or mismanaged positions.
"""
import time
from decimal import Decimal

from agent.config import UnderlyingConfig
from agent.runner import snapshot_for
from agent.strategy.covered_call import IntentKind, Snapshot, decide
from agent.venues.base import (
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

D = Decimal
NOW = 1_800_000_000.0


def q(strike, delta, bid, ask, dte=35, ot=OptionType.CALL, name=None,
      step="0.1", min_amt="0.1"):
    return OptionQuote(
        instrument_name=name or f"ETH-X-{strike}-{ot.value}",
        underlying="ETH",
        expiry_ts=int(NOW + dte * 86400),
        strike=D(str(strike)),
        option_type=ot,
        bid=D(str(bid)) if bid is not None else None,
        ask=D(str(ask)) if ask is not None else None,
        mark=(D(str(bid)) + D(str(ask))) / 2
        if bid is not None and ask is not None else D("1"),
        delta=D(str(delta)),
        iv=D("0.5"),
        open_interest=D(100),
        amount_step=D(step),
        min_amount=D(min_amt),
        timestamp=NOW,
    )


class StubVenue(Venue):
    """Minimal venue exposing exactly what snapshot_for needs."""

    name = "stub"

    def __init__(self, chain=(), positions=(), balances=()):
        self._chain = list(chain)
        self._positions = list(positions)
        self._balances = list(balances)

    def spot(self, underlying):
        return D("3800")

    def option_chain(self, underlying):
        return list(self._chain)

    def positions(self):
        return list(self._positions)

    def balances(self):
        return list(self._balances)

    def margin(self):
        return MarginSummary(D("50000"), D("1000"), D("500"))

    def place_limit(self, **kw):
        raise AssertionError("must not trade")

    def order_status(self, instrument_name, order_id):
        raise AssertionError("no orders")

    def cancel(self, instrument_name, order_id):
        pass

    def cancel_all(self):
        pass

    def now(self):
        return NOW


class TestSnapshotSymbolMatching:
    def test_lookalike_instrument_prefixes_are_not_matched(self):
        """SOL must not pick up SOLVBTC positions; ETH not ETHW etc."""
        positions = [
            Position("ETH-20260301-4000-C", D("-1"), D("50"), D("40")),
            Position("ETHW-20260301-4000-C", D("-7"), D("50"), D("40")),
            Position("ETHENA-20260301-1-C", D("-3"), D("1"), D("1")),
        ]
        venue = StubVenue(positions=positions, balances=[Balance("ETH", D("10"))])
        snap = snapshot_for(venue, UnderlyingConfig(symbol="ETH"))
        assert [p.instrument_name for p in snap.short_calls] == [
            "ETH-20260301-4000-C"
        ]

    def test_lookalike_balance_assets_are_not_matched(self):
        """Symbol ETH must never count an 'ETHENA' balance as cover."""
        venue = StubVenue(balances=[
            Balance("ETHENA", D("100000")),
            Balance("USDC", D("5000")),
        ])
        snap = snapshot_for(venue, UnderlyingConfig(symbol="ETH"))
        assert snap.held_units == 0
        # and therefore no sells against phantom cover
        assert decide(snap, UnderlyingConfig(symbol="ETH")) == []

    def test_collateral_alias_hook_counts_wrapped_assets(self):
        """A venue may declare WETH as ETH cover; amounts are summed."""
        class AliasVenue(StubVenue):
            def collateral_assets(self, underlying):
                return ("ETH", "WETH")

        venue = AliasVenue(balances=[
            Balance("WETH", D("4")), Balance("ETH", D("6")),
            Balance("ETHENA", D("100000")),
        ])
        snap = snapshot_for(venue, UnderlyingConfig(symbol="ETH"))
        assert snap.held_units == D("10")

    def test_short_puts_are_not_treated_as_short_calls(self):
        """A short PUT neither consumes call capacity nor gets 'managed'
        (bought back) by the covered-call rules."""
        put = q(3400, "-0.25", 60, 66, dte=10, ot=OptionType.PUT,
                name="ETH-20260210-3400-P")
        call = q(4400, "0.25", 55, 62)
        positions = [Position("ETH-20260210-3400-P", D("-5"), D("60"), D("63"))]
        venue = StubVenue(chain=[put, call], positions=positions,
                          balances=[Balance("ETH", D("10"))])
        cfg = UnderlyingConfig(symbol="ETH", max_order=D("50"))
        snap = snapshot_for(venue, cfg)
        assert snap.short_calls == []
        intents = decide(snap, cfg)
        # no buy-back of the put (dte 10 <= roll_dte would have fired)
        assert not [i for i in intents if i.kind == IntentKind.BUY_BACK]
        # capacity is the full 9.0 (puts don't consume call coverage)
        sells = [i for i in intents if i.kind == IntentKind.SELL_CALL]
        assert sells and sells[0].amount == D("9.0")


class TestDecideEdges:
    def _snap(self, chain, shorts=(), held="10"):
        return Snapshot("ETH", D("3800"), list(chain), list(shorts),
                        D(held), NOW)

    def test_zero_and_negative_holdings_never_sell(self):
        chain = [q(4400, "0.25", 55, 62)]
        cfg = UnderlyingConfig(symbol="ETH")
        assert decide(self._snap(chain, held="0"), cfg) == []
        assert decide(self._snap(chain, held="-3"), cfg) == []

    def test_chain_with_only_puts_sells_nothing(self):
        chain = [q(3400, "-0.25", 60, 66, ot=OptionType.PUT),
                 q(3000, "-0.10", 20, 24, ot=OptionType.PUT)]
        assert decide(self._snap(chain), UnderlyingConfig(symbol="ETH")) == []

    def test_take_profit_with_zero_average_price_no_crash_no_intent(self):
        held = q(4400, "0.25", 40, 44, name="ETH-HELD-4400-C")
        shorts = [Position("ETH-HELD-4400-C", D("-1"), D("0"), D("42"))]
        intents = decide(self._snap([held], shorts),
                         UnderlyingConfig(symbol="ETH"))
        assert not [i for i in intents
                    if i.kind == IntentKind.BUY_BACK and "take-profit" in i.reason]

    def test_position_missing_from_chain_still_consumes_capacity(self):
        fresh = q(4400, "0.25", 55, 62)
        shorts = [Position("ETH-GONE-4200-C", D("-4"), D("50"), D("40"))]
        cfg = UnderlyingConfig(symbol="ETH", max_order=D("50"))
        intents = decide(self._snap([fresh], shorts), cfg)
        sells = [i for i in intents if i.kind == IntentKind.SELL_CALL]
        # 10 * 0.9 - 4 = 5.0, never more
        assert sells and sells[0].amount == D("5.0")
        assert sells[0].amount + D("4") <= D("10")

    def test_fractional_amount_step_never_breaks_coverage(self):
        """amount_step coarser than min_order must round DOWN, not up."""
        fresh = q(4400, "0.25", 55, 62, step="0.3", min_amt="0.3")
        cfg = UnderlyingConfig(symbol="ETH", max_utilization=D("1"),
                               max_order=D("50"))
        intents = decide(self._snap([fresh], held="1"), cfg)
        sells = [i for i in intents if i.kind == IntentKind.SELL_CALL]
        for s in sells:
            assert s.amount <= D("1")
            # a multiple of the venue step
            assert (s.amount / D("0.3")) % 1 == 0

    def test_tiny_capacity_below_step_sells_nothing(self):
        fresh = q(4400, "0.25", 55, 62, step="0.3", min_amt="0.3")
        cfg = UnderlyingConfig(symbol="ETH", max_utilization=D("1"))
        shorts = [Position("ETH-X-4500-C", D("-0.8"), D("50"), D("40"))]
        intents = decide(self._snap([fresh], shorts, held="1"), cfg)
        assert not [i for i in intents if i.kind == IntentKind.SELL_CALL]
