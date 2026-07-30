"""Adversarial audit tests: executor reprice loop, cancel/fill races,
partial fills, defensive-roll leg-2 credit enforcement, close-all gating.
"""
import time
from decimal import Decimal
from pathlib import Path

import agent.main as agent_main
import agent.runner as runner_mod
from agent.config import AgentConfig, ExecutionConfig, RiskConfig, UnderlyingConfig
from agent.runner import Executor, run_cycle
from agent.state import StateStore
from agent.strategy.covered_call import Intent, IntentKind, Side
from agent.venues.base import (
    Balance,
    MarginSummary,
    OptionQuote,
    OptionType,
    OrderResult,
    OrderState,
    Position,
    Venue,
)
from agent.venues.mock import MockVenue

D = Decimal


def make_cfg(tmp_path, **kw) -> AgentConfig:
    return AgentConfig(
        venue="mock",
        state_db=str(tmp_path / "t.db"),
        log_dir=str(tmp_path / "logs"),
        dry_run=kw.pop("dry_run", False),
        underlyings=kw.pop("underlyings", (
            UnderlyingConfig(symbol="ETH", min_order=D("0.1"), max_order=D("5")),
        )),
        execution=kw.pop("execution", ExecutionConfig(fill_timeout_sec=0.01)),
        risk=kw.pop("risk", RiskConfig(
            kill_switch_file=str(tmp_path / "KILL"),
            pause_file=str(tmp_path / "PAUSE"),
        )),
        **kw,
    )


def fresh_quote(name="ETH-TEST-4200-C", bid="80", ask="86"):
    return OptionQuote(
        instrument_name=name, underlying="ETH",
        expiry_ts=int(time.time() + 35 * 86400), strike=D("4200"),
        option_type=OptionType.CALL, bid=D(bid), ask=D(ask),
        mark=(D(bid) + D(ask)) / 2, delta=D("0.25"), iv=D("0.5"),
        timestamp=time.time(),
    )


class ScriptedVenue(Venue):
    """Orders behave per a scripted sequence of (place_result, status_after_
    poll, status_after_cancel) tuples, one per placement."""

    name = "scripted"

    def __init__(self, script):
        self.script = list(script)
        self.placements = []           # (amount, limit_price)
        self.cancels = []
        self._i = -1

    # -- unused surface --------------------------------------------------
    def spot(self, u):
        return D("3800")

    def option_chain(self, u):
        return []

    def positions(self):
        return []

    def balances(self):
        return []

    def margin(self):
        return MarginSummary(D("50000"), D("1000"), D("500"))

    # -- scripted orders --------------------------------------------------
    def place_limit(self, instrument_name, side, amount, limit_price,
                    label="", post_only=False, reduce_only=False):
        self._i += 1
        if self._i >= len(self.script):
            raise AssertionError(
                f"unexpected placement #{self._i + 1}: {amount} @ {limit_price}"
            )
        self.placements.append((amount, limit_price))
        place, _poll, _post_cancel = self.script[self._i]
        return place(str(self._i), amount)

    def order_status(self, instrument_name, order_id):
        i = int(order_id)
        _place, poll, post_cancel = self.script[i]
        if i in [int(c) for c in self.cancels]:
            return post_cancel(order_id, self.placements[i][0])
        return poll(order_id, self.placements[i][0])

    def cancel(self, instrument_name, order_id):
        self.cancels.append(order_id)

    def cancel_all(self):
        pass


def _open(oid, amt):
    return OrderResult(oid, OrderState.OPEN)


def _filled(oid, amt):
    return OrderResult(oid, OrderState.FILLED, amt, D("81"))


def _cancelled(oid, amt):
    return OrderResult(oid, OrderState.CANCELLED)


def sell_intent(amount="1"):
    return Intent(IntentKind.SELL_CALL, "ETH", "ETH-TEST-4200-C",
                  Side.SELL, D(amount), fresh_quote(), "audit")


class TestExecutorRaces:
    def test_fill_during_cancel_race_is_not_replaced(self, tmp_path):
        """Order fills between the last poll and the cancel: the executor
        must detect the fill post-cancel and NOT place a second order
        (double-placing a sell breaks the covered invariant)."""
        venue = ScriptedVenue([
            # placement 0: open while polled, but FILLED when checked
            # after cancel (the race).
            (_open, _open, _filled),
        ])
        cfg = make_cfg(tmp_path)
        ex = Executor(cfg, venue, StateStore(cfg.state_db))
        result = ex.execute(sell_intent("1"))
        assert result == OrderState.FILLED
        assert len(venue.placements) == 1, "raced fill must not be re-placed"
        assert ex.last_filled_amount == D("1")

    def test_partial_fill_reprices_only_remainder(self, tmp_path):
        """A partial fill then cancel must reduce the next order's size;
        re-placing the full amount would oversell."""
        def _part_cancelled(oid, amt):
            return OrderResult(oid, OrderState.CANCELLED, D("0.4"), D("82"))

        venue = ScriptedVenue([
            (_open, _open, _part_cancelled),      # fills 0.4 of 1.0
            (lambda oid, amt: OrderResult(oid, OrderState.FILLED, amt, D("80")),
             _open, _cancelled),                  # remainder fills at once
        ])
        cfg = make_cfg(tmp_path)
        ex = Executor(cfg, venue, StateStore(cfg.state_db))
        result = ex.execute(sell_intent("1"))
        assert result == OrderState.FILLED
        amounts = [a for a, _ in venue.placements]
        assert amounts == [D("1"), D("0.6")]
        assert ex.last_filled_amount == D("1")
        # weighted average fill price: 0.4*82 + 0.6*80
        assert ex.last_fill_price == (D("0.4") * 82 + D("0.6") * 80)

    def test_unfilled_partial_reports_partial_not_cancelled(self, tmp_path):
        def _part_cancelled(oid, amt):
            return OrderResult(oid, OrderState.CANCELLED, D("0.4"), D("82"))

        venue = ScriptedVenue([
            (_open, _open, _part_cancelled),
            (_open, _open, _cancelled),
            (_open, _open, _cancelled),
            (_open, _open, _cancelled),
        ])
        cfg = make_cfg(tmp_path)
        ex = Executor(cfg, venue, StateStore(cfg.state_db))
        result = ex.execute(sell_intent("1"))
        assert result == OrderState.PARTIAL
        assert ex.last_filled_amount == D("0.4")

    def test_place_exception_fails_closed(self, tmp_path):
        """A venue error on placement (e.g. post-only cross) must not crash
        the cycle nor spin more placements."""
        class Boom(ScriptedVenue):
            def place_limit(self, *a, **kw):
                raise RuntimeError("api error")

        venue = Boom([])
        cfg = make_cfg(tmp_path)
        ex = Executor(cfg, venue, StateStore(cfg.state_db))
        result = ex.execute(sell_intent("1"))
        assert result == OrderState.CANCELLED
        assert ex.last_filled_amount == 0


class TestDefensiveRollLeg2:
    def test_leg2_skipped_when_roll_would_be_debit(self, tmp_path, monkeypatch):
        """If the replacement's sell price no longer covers the actual leg-1
        buyback cost, leg 2 must NOT be placed (credit-only rolls)."""
        held_q = fresh_quote("ETH-HELD-3900-C", bid="180", ask="190")
        # replacement bid well below what leg 1 will cost: px2 < leg1 cost
        repl_q = fresh_quote("ETH-REPL-4300-C", bid="100", ask="110")
        buyback = Intent(IntentKind.BUY_BACK, "ETH", "ETH-HELD-3900-C",
                         Side.BUY, D("1"), held_q, "defensive roll leg 1",
                         replacement=repl_q)

        class RollVenue(ScriptedVenue):
            def option_chain(self, u):
                return [held_q, repl_q]

            def balances(self):
                return [Balance("ETH", D("10"))]

            def positions(self):
                return [Position("ETH-HELD-3900-C", D("-1"), D("60"), D("185"))]

        venue = RollVenue([
            # leg 1 buy fills at 190 (the ask)
            (lambda oid, amt: OrderResult(oid, OrderState.FILLED, amt, D("190")),
             _open, _cancelled),
        ])
        monkeypatch.setattr(runner_mod, "decide", lambda snap, cfg, **kw: [buyback])
        cfg = make_cfg(tmp_path)
        state = StateStore(cfg.state_db)
        summary = run_cycle(cfg, venue, state)
        entry = summary["underlyings"]["ETH"]
        assert len(venue.placements) == 1, "leg 2 must not fire on a debit roll"
        assert any("no longer net-credit" in v for v in entry["vetoed"])

    def test_leg2_fires_when_still_credit(self, tmp_path, monkeypatch):
        held_q = fresh_quote("ETH-HELD-3900-C", bid="180", ask="190")
        repl_q = fresh_quote("ETH-REPL-4300-C", bid="195", ask="205")
        buyback = Intent(IntentKind.BUY_BACK, "ETH", "ETH-HELD-3900-C",
                         Side.BUY, D("1"), held_q, "defensive roll leg 1",
                         replacement=repl_q)

        class RollVenue(ScriptedVenue):
            def option_chain(self, u):
                return [held_q, repl_q]

            def balances(self):
                return [Balance("ETH", D("10"))]

            def positions(self):
                return [Position("ETH-HELD-3900-C", D("-1"), D("60"), D("185"))]

        venue = RollVenue([
            (lambda oid, amt: OrderResult(oid, OrderState.FILLED, amt, D("190")),
             _open, _cancelled),
            (lambda oid, amt: OrderResult(oid, OrderState.FILLED, amt, D("197")),
             _open, _cancelled),
        ])
        monkeypatch.setattr(runner_mod, "decide", lambda snap, cfg, **kw: [buyback])
        cfg = make_cfg(tmp_path)
        summary = run_cycle(cfg, venue, StateStore(cfg.state_db))
        assert len(venue.placements) == 2
        # leg 2 is a sell of the replacement
        assert any("ETH-REPL-4300-C" in e
                   for e in summary["underlyings"]["ETH"]["executed"])


class TestCloseAllGate:
    def _venue_with_short(self):
        venue = MockVenue(spots={"ETH": D("3800")}, ivs={"ETH": D("0.50")},
                          holdings={"ETH": D("10")})
        call = next(q for q in venue.option_chain("ETH")
                    if q.option_type == OptionType.CALL and q.bid and q.bid > 1)
        venue.place_limit(call.instrument_name, Side.SELL, D("1"), call.bid)
        assert any(p.amount < 0 for p in venue.positions())
        return venue

    def test_close_all_respects_kill_switch(self, tmp_path, monkeypatch):
        venue = self._venue_with_short()
        n_before = len(venue.fills)
        cfg = make_cfg(tmp_path)
        Path(cfg.risk.kill_switch_file).touch()
        monkeypatch.setattr(agent_main, "build_venue", lambda c: venue)
        agent_main.cmd_close_all(cfg)
        buys = [f for f in venue.fills[n_before:] if f["side"] == "buy"]
        assert buys == [], "kill switch must veto close-all orders too"

    def test_close_all_buys_back_when_allowed(self, tmp_path, monkeypatch):
        venue = self._venue_with_short()
        n_before = len(venue.fills)
        cfg = make_cfg(tmp_path)
        monkeypatch.setattr(agent_main, "build_venue", lambda c: venue)
        agent_main.cmd_close_all(cfg)
        buys = [f for f in venue.fills[n_before:] if f["side"] == "buy"]
        assert buys, "close-all should buy back the short"
        assert all(p.amount >= 0 for p in venue.positions())
