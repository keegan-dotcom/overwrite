"""Risk gate + end-to-end mock-venue cycle tests."""
import time
from decimal import Decimal
from pathlib import Path

import pytest

from agent.config import AgentConfig, ExecutionConfig, RiskConfig, UnderlyingConfig
from agent.runner import run_cycle
from agent.state import StateStore
from agent.strategy.covered_call import Intent, IntentKind, Side
from agent.strategy.risk import RiskGate
from agent.venues.base import MarginSummary, OptionQuote, OptionType
from agent.venues.mock import MockVenue

D = Decimal


def make_cfg(tmp_path, **kw) -> AgentConfig:
    risk = kw.pop("risk", RiskConfig(
        kill_switch_file=str(tmp_path / "KILL"),
        pause_file=str(tmp_path / "PAUSE"),
    ))
    return AgentConfig(
        venue="mock",
        state_db=str(tmp_path / "t.db"),
        log_dir=str(tmp_path / "logs"),
        dry_run=kw.pop("dry_run", False),
        underlyings=kw.pop("underlyings", (
            UnderlyingConfig(symbol="ETH", min_order=D("0.1"), max_order=D("5")),
        )),
        execution=kw.pop("execution", ExecutionConfig(fill_timeout_sec=0.01)),
        risk=risk,
        **kw,
    )


def make_venue():
    return MockVenue(
        spots={"ETH": D("3800")},
        ivs={"ETH": D("0.50")},
        holdings={"ETH": D("10")},
    )


def fresh_quote():
    return OptionQuote(
        instrument_name="ETH-TEST-4200-C", underlying="ETH",
        expiry_ts=int(time.time() + 35 * 86400), strike=D("4200"),
        option_type=OptionType.CALL, bid=D("80"), ask=D("86"),
        mark=D("83"), delta=D("0.25"), iv=D("0.5"), timestamp=time.time(),
    )


def sell_intent(amount="1"):
    return Intent(IntentKind.SELL_CALL, "ETH", "ETH-TEST-4200-C",
                  Side.SELL, D(amount), fresh_quote(), "test")


def margin_ok():
    return MarginSummary(D("50000"), D("1000"), D("500"))


class TestRiskGate:
    def test_kill_switch_vetoes_everything(self, tmp_path):
        cfg = make_cfg(tmp_path)
        Path(cfg.risk.kill_switch_file).touch()
        gate = RiskGate(cfg, StateStore(cfg.state_db))
        v = gate.check(sell_intent(), D("83"), margin_ok(), D("50000"), D("10"), D(0))
        assert not v.allowed and "KILL" in v.reason

    def test_pause_blocks_sells_not_buybacks(self, tmp_path):
        cfg = make_cfg(tmp_path)
        Path(cfg.risk.pause_file).touch()
        gate = RiskGate(cfg, StateStore(cfg.state_db))
        v = gate.check(sell_intent(), D("83"), margin_ok(), D("50000"), D("10"), D(0))
        assert not v.allowed
        bb = Intent(IntentKind.BUY_BACK, "ETH", "ETH-TEST-4200-C",
                    Side.BUY, D("1"), fresh_quote(), "test")
        v2 = gate.check(bb, D("83"), margin_ok(), D("50000"), D("10"), D("1"))
        assert v2.allowed

    def test_margin_ceiling(self, tmp_path):
        cfg = make_cfg(tmp_path)
        gate = RiskGate(cfg, StateStore(cfg.state_db))
        tight = MarginSummary(D("1000"), D("900"), D("800"))  # 80% usage
        v = gate.check(sell_intent(), D("83"), tight, D("1000"), D("10"), D(0))
        assert not v.allowed and "maintenance" in v.reason

    def test_coverage_violation_veto(self, tmp_path):
        cfg = make_cfg(tmp_path)
        gate = RiskGate(cfg, StateStore(cfg.state_db))
        v = gate.check(sell_intent("6"), D("83"), margin_ok(), D("50000"),
                       D("10"), D("5"))  # 5 short + 6 new > 10 held
        assert not v.allowed and "COVERAGE" in v.reason

    def test_stale_quote_veto(self, tmp_path):
        cfg = make_cfg(tmp_path)
        gate = RiskGate(cfg, StateStore(cfg.state_db))
        old = fresh_quote()
        stale = OptionQuote(**{**old.__dict__, "timestamp": time.time() - 600})
        i = Intent(IntentKind.SELL_CALL, "ETH", stale.instrument_name,
                   Side.SELL, D("1"), stale, "test")
        v = gate.check(i, D("83"), margin_ok(), D("50000"), D("10"), D(0))
        assert not v.allowed and "stale" in v.reason

    def test_price_deviation_veto(self, tmp_path):
        cfg = make_cfg(tmp_path)
        gate = RiskGate(cfg, StateStore(cfg.state_db))
        v = gate.check(sell_intent(), D("30"), margin_ok(), D("50000"), D("10"), D(0))
        assert not v.allowed

    def test_drawdown_pause(self, tmp_path):
        cfg = make_cfg(tmp_path)
        state = StateStore(cfg.state_db)
        state.record_equity(D("100000"))
        gate = RiskGate(cfg, state)
        v = gate.check(sell_intent(), D("83"), margin_ok(), D("80000"), D("10"), D(0))
        assert not v.allowed and "drawdown" in v.reason

    def test_order_budget(self, tmp_path):
        cfg = make_cfg(tmp_path, risk=RiskConfig(
            max_orders_per_day=1,
            kill_switch_file=str(tmp_path / "KILL"),
            pause_file=str(tmp_path / "PAUSE"),
        ))
        state = StateStore(cfg.state_db)
        state.record_order("mock", "X", "sell", D(1), D(1), "filled", None, "t")
        gate = RiskGate(cfg, state)
        v = gate.check(sell_intent(), D("83"), margin_ok(), D("50000"), D("10"), D(0))
        assert not v.allowed and "budget" in v.reason

    def test_fails_closed_on_error(self, tmp_path):
        cfg = make_cfg(tmp_path)
        gate = RiskGate(cfg, StateStore(cfg.state_db))
        v = gate.check(sell_intent(), D("83"), None, D("1"), D("10"), D(0))  # type: ignore
        assert not v.allowed and "failing closed" in v.reason


class TestEndToEnd:
    def test_dry_run_places_nothing(self, tmp_path):
        cfg = make_cfg(tmp_path, dry_run=True)
        venue = make_venue()
        summary = run_cycle(cfg, venue, StateStore(cfg.state_db))
        assert venue.fills == []
        ex = summary["underlyings"]["ETH"]["executed"]
        assert ex and all(e.startswith("DRY-RUN") for e in ex)

    def test_live_cycle_sells_covered_calls(self, tmp_path):
        cfg = make_cfg(tmp_path, dry_run=False)
        venue = make_venue()
        summary = run_cycle(cfg, venue, StateStore(cfg.state_db))
        sells = [f for f in venue.fills if f["side"] == "sell"]
        assert sells, summary
        total_sold = sum(f["amount"] for f in sells)
        assert total_sold <= D("10") * D("0.90")
        # all fills are calls within delta band? verify via names present in chain
        names = {q.instrument_name for q in venue.option_chain("ETH")
                 if q.option_type.value == "C"}
        assert all(f["instrument"] in names for f in sells)

    def test_cycle_records_state(self, tmp_path):
        cfg = make_cfg(tmp_path, dry_run=False)
        venue = make_venue()
        state = StateStore(cfg.state_db)
        run_cycle(cfg, venue, state)
        assert state.premium_collected() > 0
        assert state.orders_last_24h() > 0
        assert state.equity_high_water() > 0

    def test_cycles_converge_to_full_coverage_then_idempotent(self, tmp_path):
        cfg = make_cfg(tmp_path, dry_run=False)
        venue = make_venue()
        state = StateStore(cfg.state_db)
        # capacity = 10 * 0.9 = 9 with max_order 5: fills over two cycles
        run_cycle(cfg, venue, state)
        run_cycle(cfg, venue, state)
        sold = sum(f["amount"] for f in venue.fills if f["side"] == "sell")
        assert sold == D("9.0")
        # third cycle: fully covered, no management triggers -> no new fills
        n_fills = len(venue.fills)
        run_cycle(cfg, venue, state)
        assert len(venue.fills) == n_fills

    def test_settlement_frees_capacity(self, tmp_path):
        cfg = make_cfg(tmp_path, dry_run=False)
        venue = make_venue()
        state = StateStore(cfg.state_db)
        run_cycle(cfg, venue, state)
        assert any(f["side"] == "sell" for f in venue.fills)
        # jump past all expiries with spot below strikes -> worthless expiry
        venue.advance(70, {"ETH": D("3500")})
        assert all(
            p.amount == 0 for p in venue.positions()
        ), "expired positions should be flat"
        run_cycle(cfg, venue, state)
        sells_after = [f for f in venue.fills if f["side"] == "sell"]
        assert len(sells_after) >= 2, "should re-sell after settlement"
