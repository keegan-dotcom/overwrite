"""Maker mode: quoting into empty books at mark, resting orders, risk gating."""
import time
from decimal import Decimal

from agent.config import AgentConfig, ExecutionConfig, RiskConfig, UnderlyingConfig
from agent.runner import Executor, _limit_price
from agent.state import StateStore
from agent.strategy.covered_call import (
    Intent, IntentKind, Side, Snapshot, decide, select_call_to_sell,
)
from agent.strategy.risk import RiskGate
from agent.venues.base import (
    Balance, MarginSummary, OptionQuote, OptionType, OrderResult, OrderState, Venue,
)

D = Decimal
NOW = 1_800_000_000.0


def empty_book_call(name="ETH-X-4400-C", delta="0.25", mark="62", dte=35):
    return OptionQuote(
        instrument_name=name, underlying="ETH",
        expiry_ts=int(NOW + dte * 86400), strike=D("4400"),
        option_type=OptionType.CALL, bid=None, ask=None,
        mark=D(mark), delta=D(delta), iv=D("0.5"), timestamp=time.time(),
    )


def snap(chain, held="10"):
    return Snapshot(underlying="ETH", spot=D("3800"), chain=list(chain),
                    short_calls=[], held_units=D(held), now_ts=NOW)


def ucfg(**kw):
    return UnderlyingConfig(symbol="ETH", **kw)


class TestSelection:
    def test_taker_mode_skips_empty_book(self):
        assert select_call_to_sell(snap([empty_book_call()]), ucfg()) is None

    def test_maker_mode_accepts_empty_book_with_mark(self):
        q = select_call_to_sell(snap([empty_book_call()]), ucfg(), maker=True)
        assert q is not None and q.instrument_name == "ETH-X-4400-C"

    def test_maker_mode_still_needs_positive_mark(self):
        q = empty_book_call(mark="0")
        assert select_call_to_sell(snap([q]), ucfg(), maker=True) is None

    def test_maker_mode_still_enforces_yield_floor(self):
        # mark 5 on 3800 spot over 35d ~ 1.4% ann < 6% floor
        q = empty_book_call(mark="5")
        assert select_call_to_sell(snap([q]), ucfg(), maker=True) is None

    def test_decide_emits_sell_in_maker_mode(self):
        intents = decide(snap([empty_book_call()]), ucfg(), maker=True)
        sells = [i for i in intents if i.kind == IntentKind.SELL_CALL]
        assert len(sells) == 1


class TestPricing:
    def test_maker_price_at_mark(self):
        q = empty_book_call(mark="62")
        px = _limit_price(q, Side.SELL, 0, D("0.25"), maker=True)
        assert abs(px - D("62")) <= q.tick_size

    def test_maker_reprice_concedes_down_for_sells(self):
        q = empty_book_call(mark="62")
        p0 = _limit_price(q, Side.SELL, 0, D("0.25"), maker=True)
        p2 = _limit_price(q, Side.SELL, 2, D("0.25"), maker=True)
        assert p2 < p0

    def test_taker_still_raises_without_book(self):
        import pytest
        with pytest.raises(ValueError):
            _limit_price(empty_book_call(), Side.SELL, 0, D("0.25"), maker=False)


class TestRiskGate:
    def _cfg(self, tmp_path, maker):
        return AgentConfig(
            venue="mock", state_db=str(tmp_path / "t.db"),
            log_dir=str(tmp_path / "logs"), dry_run=False,
            underlyings=(ucfg(),),
            execution=ExecutionConfig(fill_timeout_sec=0.01, maker_mode=maker),
            risk=RiskConfig(kill_switch_file=str(tmp_path / "K"),
                            pause_file=str(tmp_path / "P")),
        )

    def test_gate_rejects_empty_book_without_maker(self, tmp_path):
        cfg = self._cfg(tmp_path, maker=False)
        gate = RiskGate(cfg, StateStore(cfg.state_db))
        i = Intent(IntentKind.SELL_CALL, "ETH", "ETH-X-4400-C", Side.SELL,
                   D("1"), empty_book_call(), "t")
        v = gate.check(i, D("62"), MarginSummary(D("50000"), D(0), D(0)),
                       D("50000"), D("10"), D(0))
        assert not v.allowed and "book" in v.reason

    def test_gate_allows_empty_book_with_maker(self, tmp_path):
        cfg = self._cfg(tmp_path, maker=True)
        gate = RiskGate(cfg, StateStore(cfg.state_db))
        i = Intent(IntentKind.SELL_CALL, "ETH", "ETH-X-4400-C", Side.SELL,
                   D("1"), empty_book_call(), "t")
        v = gate.check(i, D("62"), MarginSummary(D("50000"), D(0), D(0)),
                       D("50000"), D("10"), D(0))
        assert v.allowed, v.reason

    def test_gate_still_bounds_deviation_in_maker_mode(self, tmp_path):
        cfg = self._cfg(tmp_path, maker=True)
        gate = RiskGate(cfg, StateStore(cfg.state_db))
        i = Intent(IntentKind.SELL_CALL, "ETH", "ETH-X-4400-C", Side.SELL,
                   D("1"), empty_book_call(mark="62"), "t")
        v = gate.check(i, D("20"), MarginSummary(D("50000"), D(0), D(0)),
                       D("50000"), D("10"), D(0))
        assert not v.allowed and "deviates" in v.reason


class _RestingVenue(Venue):
    """Stub: every order rests (never fills), to exercise the resting path."""

    name = "stub"

    def __init__(self):
        self.placed = []
        self.cancelled = []

    def spot(self, u): return D("3800")
    def option_chain(self, u): return [empty_book_call()]
    def positions(self): return []
    def balances(self): return [Balance("ETH", D("10"), D("38000"))]
    def margin(self): return MarginSummary(D("38000"), D(0), D(0))

    def place_limit(self, instrument_name, side, amount, limit_price,
                    label="", post_only=False, reduce_only=False):
        oid = str(len(self.placed) + 1)
        self.placed.append(
            {"id": oid, "px": limit_price, "post_only": post_only})
        return OrderResult(oid, OrderState.OPEN)

    def order_status(self, instrument_name, order_id):
        return OrderResult(order_id, OrderState.OPEN)

    def cancel(self, instrument_name, order_id):
        self.cancelled.append(order_id)

    def cancel_all(self):
        self.cancelled.append("ALL")


class TestRestingExecution:
    def test_final_maker_quote_left_resting(self, tmp_path):
        cfg = AgentConfig(
            venue="mock", state_db=str(tmp_path / "t.db"),
            log_dir=str(tmp_path / "logs"), dry_run=False,
            underlyings=(ucfg(),),
            execution=ExecutionConfig(fill_timeout_sec=0.01, max_reprices=2,
                                      maker_mode=True),
            risk=RiskConfig(kill_switch_file=str(tmp_path / "K"),
                            pause_file=str(tmp_path / "P")),
        )
        venue = _RestingVenue()
        ex = Executor(cfg, venue, StateStore(cfg.state_db))
        i = Intent(IntentKind.SELL_CALL, "ETH", "ETH-X-4400-C", Side.SELL,
                   D("1"), empty_book_call(), "t")
        result = ex.execute(i)
        assert result == OrderState.OPEN                 # resting, not cancelled
        assert len(venue.placed) == 3                    # step 0,1,2
        assert all(p["post_only"] for p in venue.placed)  # maker = always post-only
        # first two got cancelled on reprice; the LAST one is left resting
        assert len(venue.cancelled) == 2
