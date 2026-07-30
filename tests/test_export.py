"""status.json exporter tests."""
import json
from decimal import Decimal
from pathlib import Path

from agent.config import AgentConfig, ExecutionConfig, RiskConfig, UnderlyingConfig
from agent.export import build_status, export_status
from agent.runner import run_cycle
from agent.state import StateStore
from agent.venues.mock import MockVenue

D = Decimal


def make_cfg(tmp_path, **kw):
    return AgentConfig(
        venue="mock", state_db=str(tmp_path / "t.db"),
        log_dir=str(tmp_path / "logs"),
        status_export=kw.pop("status_export", str(tmp_path / "status.json")),
        dry_run=kw.pop("dry_run", False),
        underlyings=(UnderlyingConfig(symbol="ETH", min_order=D("0.1"),
                                      max_order=D("5")),),
        execution=ExecutionConfig(fill_timeout_sec=0.01),
        risk=RiskConfig(kill_switch_file=str(tmp_path / "K"),
                        pause_file=str(tmp_path / "P")),
    )


def test_export_after_live_cycle(tmp_path):
    cfg = make_cfg(tmp_path)
    venue = MockVenue(spots={"ETH": D("3800")}, ivs={"ETH": D("0.50")},
                      holdings={"ETH": D("10")})
    state = StateStore(cfg.state_db)
    run_cycle(cfg, venue, state)
    out = export_status(cfg, state, venue)
    assert out is not None
    data = json.loads(Path(out).read_text())
    assert data["premium_total_usd"] > 0
    assert data["orders_24h"] >= 1
    assert len(data["ledger"]) >= 1
    assert data["ledger"][0]["kind"] == "premium_in"
    assert len(data["positions"]) >= 1
    assert data["positions"][0]["size"] < 0
    assert data["cycles"], "cycle log present"
    # no secrets anywhere in the payload
    blob = json.dumps(data)
    assert "SESSION" not in blob.upper() or "0x" not in blob


def test_export_disabled_when_no_path(tmp_path):
    cfg = make_cfg(tmp_path, status_export="")
    state = StateStore(cfg.state_db)
    assert export_status(cfg, state) is None


def test_build_status_offline_without_venue(tmp_path):
    cfg = make_cfg(tmp_path)
    state = StateStore(cfg.state_db)
    state.record_ledger("ETH", "ETH-X-4400-C", "premium_in", D("12.33"))
    data = build_status(cfg, state, venue=None)
    assert data["positions"] == []
    assert data["premium_total_usd"] == 12.33
