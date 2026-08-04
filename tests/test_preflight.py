"""Preflight gate tests: checks, stamping, freshness."""
import json
import time
from decimal import Decimal

from agent.config import AgentConfig, UnderlyingConfig
from agent.preflight import (
    preflight_ok, run_preflight, stamp_fresh, stamp_path, write_stamp,
)
from agent.venues.mock import MockVenue


def _cfg(tmp_path, **kw) -> AgentConfig:
    defaults = dict(
        venue="mock",
        state_db=str(tmp_path / "data" / "state.db"),
        log_dir=str(tmp_path / "logs"),
        underlyings=[UnderlyingConfig(symbol="ETH", enabled=True)],
    )
    defaults.update(kw)
    cfg = AgentConfig(**defaults)
    # keep risk files inside tmp so host files can't interfere
    object.__setattr__(cfg.risk, "kill_switch_file", str(tmp_path / "KILL")) \
        if hasattr(cfg.risk, "__dataclass_fields__") and cfg.risk.__dataclass_fields__ else None
    return cfg


def _venue(_cfg_ignored=None):
    return MockVenue(
        spots={"ETH": Decimal("3800")},
        ivs={"ETH": Decimal("0.50")},
        holdings={"ETH": Decimal("10")},
    )


def test_preflight_passes_on_healthy_mock(tmp_path):
    cfg = _cfg(tmp_path)
    checks = run_preflight(cfg, _venue)
    assert preflight_ok(checks), [c for c in checks if c.level == "fail"]
    names = {c.name for c in checks}
    assert "venue" in names and "margin" in names and "market:ETH" in names


def test_preflight_fails_without_enabled_underlyings(tmp_path):
    cfg = _cfg(tmp_path, underlyings=[UnderlyingConfig(symbol="ETH", enabled=False)])
    checks = run_preflight(cfg, _venue)
    assert not preflight_ok(checks)


def test_preflight_fails_when_venue_unreachable(tmp_path):
    cfg = _cfg(tmp_path)

    def boom(_):
        raise RuntimeError("no rpc")

    checks = run_preflight(cfg, boom)
    assert not preflight_ok(checks)


def test_holdings_warn_when_uncovered(tmp_path):
    cfg = _cfg(tmp_path)

    def broke(_):
        return MockVenue(
            spots={"ETH": Decimal("3800")},
            ivs={"ETH": Decimal("0.50")},
            holdings={"ETH": Decimal("0")},
        )

    checks = run_preflight(cfg, broke)
    hold = next(c for c in checks if c.name == "holdings:ETH")
    assert hold.level == "warn"
    assert preflight_ok(checks)  # warns don't block


def test_stamp_roundtrip_and_staleness(tmp_path):
    cfg = _cfg(tmp_path)
    assert not stamp_fresh(cfg)
    checks = run_preflight(cfg, _venue)
    p = write_stamp(cfg, checks)
    assert p == stamp_path(cfg)
    assert stamp_fresh(cfg)
    # age it past 24h
    data = json.loads(p.read_text())
    data["ts"] = time.time() - 25 * 3600
    p.write_text(json.dumps(data))
    assert not stamp_fresh(cfg)


def test_garbage_stamp_is_stale(tmp_path):
    cfg = _cfg(tmp_path)
    stamp_path(cfg).parent.mkdir(parents=True, exist_ok=True)
    stamp_path(cfg).write_text("not json")
    assert not stamp_fresh(cfg)
