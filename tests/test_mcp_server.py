"""MCP server tool tests (tools called directly; no transport needed)."""
import pytest

pytest.importorskip("mcp", reason="mcp SDK not installed")

from agent import mcp_server as m  # noqa: E402


def test_quote_income_defaults():
    q = m.quote_strategy("BTC")
    assert q["strategy"] == "income" and q["runnable_by_agent"]
    assert q["legs"][0]["kind"] == "call" and q["legs"][0]["side"] == "sell"
    assert q["income_annual_pct"] > 5
    assert q["cap_price"] > q["spot"]
    assert q["tradeoffs"]


def test_quote_honesty_check_fires():
    q = m.quote_strategy("BTC", "income", target_yield_annual=0.10, cap_price=120_000)
    assert "honesty_check" in q and "120,000" in q["honesty_check"]


def test_quote_neutral_has_hedge():
    q = m.quote_strategy("ETH", "neutral")
    assert 0 < q["perp_hedge_short_per_unit"] < 1


def test_quote_spec_strategies_flagged():
    for s in ("wheel", "shield", "collar", "bear"):
        q = m.quote_strategy("ETH", s)
        assert q["runnable_by_agent"] is False and "note" in q


def test_quote_unknown_strategy_errors():
    assert "error" in m.quote_strategy("BTC", "yolo")


def test_generate_config_roundtrips(tmp_path):
    out = m.generate_config("BTC", "income", stop_loss_pct=0.2, dte=35,
                            max_order=1.2, out_path=str(tmp_path / "t.yaml"))
    assert out["runnable_by_agent"]
    text = (tmp_path / "t.yaml").read_text()
    assert "symbol: BTC" in text and "enabled: true" in text
    assert 'max_drawdown_pause: "0.20"' in text and "dry_run: true" in text
    # spec strategy stays disabled
    out2 = m.generate_config("ETH", "collar", out_path=str(tmp_path / "c.yaml"))
    assert not out2["runnable_by_agent"]
    assert "enabled: false" in (tmp_path / "c.yaml").read_text()
    # generated config loads through the real config parser
    from agent.config import load_config
    cfg = load_config(str(tmp_path / "t.yaml"))
    assert cfg.dry_run is True and cfg.underlyings[0].symbol == "BTC"


def test_go_live_instructions_never_trades(tmp_path):
    out = m.generate_config("BTC", "income", out_path=str(tmp_path / "t.yaml"))
    info = m.go_live_instructions(out["config_path"])
    assert info["this_tool_will_not_trade"] is True
    assert info["requirements"]["2_yaml_dry_run_false"] is False  # safe default
