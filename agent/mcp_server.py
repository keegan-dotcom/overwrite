"""Overwrite MCP server — talk to your options agent from Claude.

    pip install mcp
    python3 -m agent.mcp_server            # stdio transport

Claude Desktop config (Settings → Developer → Edit Config), or
`claude mcp add overwrite -- python3 -m agent.mcp_server` in Claude Code:

    {
      "mcpServers": {
        "overwrite": {
          "command": "python3",
          "args": ["-m", "agent.mcp_server"],
          "cwd": "/path/to/overwrite"
        }
      }
    }

Safety model (same rails as the CLI, deliberately conversational-safe):
  * NO tool places orders. Quoting, config generation, preflight, dry-run
    and status are exposed; the live loop must be started by a human in a
    terminal (`go_live_instructions` prints the exact command instead).
  * `dry_run_once` forces dry_run=True regardless of the YAML.
  * `preflight` is the only tool that writes the go-live stamp, and only
    when every check passes — identical to the CLI gate.
"""
from __future__ import annotations

import dataclasses
import json
import math
import os
import time
from pathlib import Path
from typing import Optional

try:
    from mcp.server.fastmcp import FastMCP
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "The Overwrite MCP server needs the MCP SDK: pip install mcp"
    ) from exc

from .strategy.greeks import (
    annualized_premium_yield, call_delta, call_price, put_price, strike_for_delta,
)

mcp = FastMCP(
    "overwrite",
    instructions=(
        "Overwrite is an intent-based options agent (covered calls & friends) "
        "on Derive. Quote strategies in plain numbers, generate runnable agent "
        "configs, run preflight and dry-run cycles, and read agent status. "
        "No tool here can place a live order - going live is always a human "
        "action in a terminal. Always surface the tradeoffs returned by "
        "quote_strategy to the user; never summarize them away."
    ),
)

# Demo pricing used when the caller doesn't supply live spot/iv.
_DEMO = {
    "BTC": (98_400.0, 0.38), "ETH": (3_820.0, 0.50), "HYPE": (44.8, 0.85),
    "SPX": (6_310.0, 0.165), "NVDA": (188.0, 0.445), "AAPL": (232.0, 0.22),
}
_STEP = {"BTC": 500, "ETH": 50, "HYPE": 1, "SPX": 25, "NVDA": 5, "AAPL": 5}
RUNNABLE = {"income", "neutral"}
STRATEGIES = ("income", "wheel", "shield", "collar", "bear", "neutral")


def _round_strike(k: float, symbol: str) -> float:
    step = _STEP.get(symbol.upper(), max(1, round(k / 100)))
    return round(k / step) * step


def _strike_for_yield(spot: float, target: float, vol: float, t: float) -> Optional[float]:
    dte = t * 365
    if annualized_premium_yield(call_price(spot, spot, vol, t), spot, dte) < target:
        return None
    lo, hi = spot, spot * 3
    for _ in range(60):
        mid = (lo + hi) / 2
        y = annualized_premium_yield(call_price(spot, mid, vol, t), spot, dte)
        if y > target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


@mcp.tool()
def quote_strategy(
    symbol: str,
    strategy: str = "income",
    target_yield_annual: Optional[float] = None,
    cap_price: Optional[float] = None,
    stop_loss_pct: Optional[float] = None,
    dte: int = 35,
    spot: Optional[float] = None,
    iv: Optional[float] = None,
) -> dict:
    """Price an Overwrite strategy with full plain-English disclosure.

    strategy: income (covered call) | wheel (cash-secured put) | shield
    (protective put) | collar | bear (put spread) | neutral (delta-hedged
    covered call). target_yield_annual as decimal (0.10 = 10%/yr).
    cap_price = 'happy to sell above' level (or desired floor for shield).
    Uses demo pricing unless spot AND iv are supplied.
    """
    sym = symbol.upper()
    strategy = strategy.lower()
    if strategy not in STRATEGIES:
        return {"error": f"unknown strategy '{strategy}'; one of {STRATEGIES}"}
    demo = spot is None or iv is None
    s, v = (spot, iv) if not demo else _DEMO.get(sym, (100.0, 0.5))
    t = dte / 365.0
    out: dict = {
        "symbol": sym, "strategy": strategy, "dte": dte,
        "pricing": "DEMO (supply spot+iv for live numbers)" if demo else "caller-supplied",
        "spot": s, "iv": v,
        "runnable_by_agent": strategy in RUNNABLE,
        "stop_loss_pct": stop_loss_pct,
    }

    def cap_strike() -> float:
        if cap_price is not None:
            k = cap_price
        elif target_yield_annual is not None:
            k = _strike_for_yield(s, target_yield_annual, v, t) or strike_for_delta(s, 0.25, v, t)
        else:
            k = strike_for_delta(s, 0.25, v, t)
        return _round_strike(max(k, s * 1.01), sym)

    if strategy in ("income", "neutral"):
        k = cap_strike()
        prem = call_price(s, k, v, t)
        yld = annualized_premium_yield(prem, s, dte)
        out.update({
            "legs": [{"side": "sell", "kind": "call", "strike": k, "premium_per_unit": round(prem, 2)}],
            "income_annual_pct": round(yld * 100, 2),
            "cap_price": k,
            "call_delta": round(call_delta(s, k, v, t), 3),
        })
        if strategy == "neutral":
            hedge = 1 - call_delta(s, k, v, t)
            out["perp_hedge_short_per_unit"] = round(hedge, 2)
            out["tradeoffs"] = [
                "Yield position, not a bet: hedged against direction both ways.",
                "Neutral at entry, not every second - sharp moves between re-hedges cost a little (gamma).",
                "Perp funding can cost or pay; it nets into realized yield.",
                "NOTE: agent runs the call leg today; the perp hedge is roadmap.",
            ]
        else:
            out["tradeoffs"] = [
                f"Above ${k:,.0f} at expiry gains are capped - you keep the climb plus premium, give up the rest.",
                "Downside NOT protected; premium only softens a fall.",
                "Income is premium actually collected per cycle, not a guaranteed APY.",
            ]
        # honesty check
        if target_yield_annual and cap_price and yld < target_yield_annual * 0.8:
            alt = _strike_for_yield(s, target_yield_annual, v, t)
            out["honesty_check"] = (
                f"A cap at ${cap_price:,.0f} only pays ~{yld*100:.1f}%/yr. "
                + (f"To earn {target_yield_annual*100:.0f}% the cap must come down to ~${_round_strike(alt, sym):,.0f}."
                   if alt else f"{target_yield_annual*100:.0f}%/yr is unreachable at today's vol even at-the-money.")
            )
    elif strategy == "wheel":
        k = _round_strike(min(strike_for_delta(s, 0.70, v, t), s * 0.97), sym)
        prem = put_price(s, k, v, t)
        out.update({
            "legs": [{"side": "sell", "kind": "put", "strike": k, "premium_per_unit": round(prem, 2)}],
            "income_annual_pct": round(annualized_premium_yield(prem, s, dte) * 100, 2),
            "tradeoffs": [
                f"Requires ${k:,.0f}/unit cash collateral.",
                f"If {sym} drops below ${k:,.0f} you buy it there even if market is lower - paid to place a limit order.",
                "Not downside protection; on assignment the wheel flips to covered calls.",
            ],
        })
    elif strategy == "shield":
        k = _round_strike(cap_price if cap_price is not None else s * 0.9, sym)
        cost = put_price(s, k, v, t)
        out.update({
            "legs": [{"side": "buy", "kind": "put", "strike": k, "premium_per_unit": round(cost, 2)}],
            "floor_price": k,
            "cost_annual_pct": round(annualized_premium_yield(cost, s, dte) * 100, 2),
            "tradeoffs": [
                f"Insurance costs real money (~${cost:,.2f}/unit per {dte}d).",
                f"Between here and ${k:,.0f} you still take the loss; below it the put pays 1:1.",
                "Full upside kept. Renewing forever in calm markets bleeds premium.",
            ],
        })
    elif strategy == "collar":
        kc = cap_strike()
        c_prem = call_price(s, kc, v, t)
        kf = s * 0.85
        for _ in range(40):
            kf += s * (0.005 if put_price(s, kf, v, t) < c_prem else -0.005)
        kf = _round_strike(min(kf, s * 0.99), sym)
        p_cost = put_price(s, kf, v, t)
        out.update({
            "legs": [
                {"side": "sell", "kind": "call", "strike": kc, "premium_per_unit": round(c_prem, 2)},
                {"side": "buy", "kind": "put", "strike": kf, "premium_per_unit": round(p_cost, 2)},
            ],
            "cap_price": kc, "floor_price": kf,
            "net_credit_per_unit": round(c_prem - p_cost, 2),
            "tradeoffs": [
                f"Locked between ${kf:,.0f} and ${kc:,.0f}; tail upside traded for tail protection.",
                "Near-zero cost: the sold call funds the bought put.",
                "In a huge rally you underperform holding - the price of the floor.",
            ],
        })
    else:  # bear
        k_hi = _round_strike(s * 0.98, sym)
        k_lo = _round_strike(s * 0.85, sym)
        cost = put_price(s, k_hi, v, t) - put_price(s, k_lo, v, t)
        out.update({
            "legs": [
                {"side": "buy", "kind": "put", "strike": k_hi, "premium_per_unit": round(put_price(s, k_hi, v, t), 2)},
                {"side": "sell", "kind": "put", "strike": k_lo, "premium_per_unit": round(put_price(s, k_lo, v, t), 2)},
            ],
            "max_loss_per_unit": round(cost, 2),
            "max_profit_per_unit": round(k_hi - k_lo - cost, 2),
            "tradeoffs": [
                f"Max loss strictly ${cost:,.2f}/unit - no liquidations, ever.",
                f"Max profit at/below ${k_lo:,.0f} at expiry.",
                "Rises or chop decay the position toward zero.",
            ],
        })
    if not out["runnable_by_agent"]:
        out["note"] = ("The open-source agent automates the covered-call family today; "
                       "this strategy exports as a SPEC config (underlying disabled).")
    return out


@mcp.tool()
def generate_config(
    symbol: str,
    strategy: str = "income",
    target_yield_annual: Optional[float] = None,
    cap_price: Optional[float] = None,
    stop_loss_pct: Optional[float] = None,
    dte: int = 35,
    max_order: float = 1.0,
    out_path: Optional[str] = None,
) -> dict:
    """Generate a runnable Overwrite agent YAML from an intent and write it
    to configs/. Returns the path, a RUNNABLE/SPEC banner, and next steps."""
    q = quote_strategy(symbol, strategy, target_yield_annual, cap_price,
                       stop_loss_pct, dte)
    if "error" in q:
        return q
    sym = symbol.upper()
    runnable = q["runnable_by_agent"]
    delta = q.get("call_delta", 0.25)
    path = Path(out_path or f"configs/{strategy}-{sym.lower()}.yaml")
    path.parent.mkdir(parents=True, exist_ok=True)
    stop = (f'  max_drawdown_pause: "{stop_loss_pct:.2f}"   # your auto-close'
            if stop_loss_pct else '  max_drawdown_pause: "0.15"')
    path.write_text(f"""# Overwrite agent config - generated via MCP
# Strategy: {strategy} on {sym} · {"RUNNABLE" if runnable else "SPEC ONLY (engine on roadmap; underlying disabled)"}
venue: derive
quote_asset: USDC
cycle_seconds: 900
state_db: data/overwrite.db
log_dir: data/logs
status_export: ""
dry_run: true

derive:
  environment: test
  extra_fee: "0"

underlyings:
  - symbol: {sym}
    enabled: {str(runnable).lower()}
    max_utilization: "0.90"
    delta_target: "{min(0.45, max(0.10, delta)):.2f}"
    delta_min: "0.10"
    delta_max: "0.45"
    dte_target: {dte}
    dte_min: {max(7, min(25, dte - 10))}
    dte_max: {dte + 25}
    roll_dte: {max(5, min(21, dte - 14))}
    take_profit_pct: "0.75"
    defensive_delta: "0.60"
    min_annualized_yield: "0.05"
    max_spread_pct: "0.15"
    min_order: "0.01"
    max_order: "{max_order}"

risk:
  max_maintenance_usage: "0.40"
  max_orders_per_day: 60
  max_price_dev_from_mark: "0.25"
  max_quote_age_sec: 90
  kill_switch_file: data/KILL
  pause_file: data/PAUSE
{stop}

execution:
  fill_timeout_sec: 45
  max_reprices: 3
  aggression: "0.25"
  post_only: true
  maker_mode: true
""")
    return {
        "config_path": str(path),
        "runnable_by_agent": runnable,
        "quote": q,
        "next_steps": [
            f"preflight(config_path='{path}')  # guided go-live inspection",
            f"dry_run_once(config_path='{path}')  # watch one cycle, no orders",
            "go_live_instructions(...)  # the human step",
        ],
    }


@mcp.tool()
def preflight(config_path: str = "configs/config.example.yaml") -> dict:
    """Run the guided go-live inspection (env, venue, margin, balances,
    chains). Writes the PREFLIGHT_OK stamp only if nothing fails - the same
    gate the CLI enforces for --live."""
    from .config import load_config
    from .main import build_venue
    from .preflight import preflight_ok, run_preflight, write_stamp

    cfg = load_config(config_path)
    checks = run_preflight(cfg, build_venue)
    ok = preflight_ok(checks)
    stamp = str(write_stamp(cfg, checks)) if ok else None
    return {
        "passed": ok,
        "stamp": stamp,
        "checks": [dataclasses.asdict(c) for c in checks],
        "note": ("Live unlocked for 24h: run `python3 -m agent.main run --config "
                 f"{config_path} --live` in a terminal (needs dry_run: false in YAML)."
                 if ok else "Fix the failing checks and re-run."),
    }


@mcp.tool()
def dry_run_once(config_path: str = "configs/config.example.yaml") -> dict:
    """Run ONE agent decision cycle with dry_run FORCED ON (no orders can be
    placed regardless of the YAML). Returns the cycle summary."""
    from .config import load_config
    from .main import build_venue
    from .runner import run_cycle
    from .state import StateStore

    cfg = dataclasses.replace(load_config(config_path), dry_run=True)
    venue = build_venue(cfg)
    state = StateStore(cfg.state_db)
    summary = run_cycle(cfg, venue, state)
    return json.loads(json.dumps({"dry_run": True, "summary": summary}, default=str))


@mcp.tool()
def agent_status(config_path: str = "configs/config.example.yaml") -> dict:
    """Premium collected (total / 30d), orders in 24h, equity high-water and
    recent cycles from the agent's state DB."""
    from .config import load_config
    from .state import StateStore

    cfg = load_config(config_path)
    state = StateStore(cfg.state_db)
    return json.loads(json.dumps({
        "premium_collected_usd_total": state.premium_collected(),
        "premium_collected_usd_30d": state.premium_collected(time.time() - 30 * 86400),
        "orders_last_24h": state.orders_last_24h(),
        "equity_high_water": state.equity_high_water(),
        "recent_cycles": state.last_cycles(5),
        "kill_switch_present": os.path.exists(cfg.risk.kill_switch_file),
        "pause_present": os.path.exists(cfg.risk.pause_file),
    }, default=str))


@mcp.tool()
def go_live_instructions(config_path: str = "configs/config.example.yaml") -> dict:
    """The human step. Returns exactly what going live requires - this tool
    NEVER starts live trading itself."""
    from .config import load_config
    from .preflight import stamp_fresh

    cfg = load_config(config_path)
    fresh = stamp_fresh(cfg)
    return {
        "this_tool_will_not_trade": True,
        "requirements": {
            "1_preflight_stamp_fresh": fresh,
            "2_yaml_dry_run_false": not cfg.dry_run,
            "3_human_runs_in_terminal":
                f"python3 -m agent.main run --config {config_path} --live",
        },
        "safety": "touch data/KILL stops everything; data/PAUSE stops new sells.",
    }


def main() -> None:  # pragma: no cover
    mcp.run()


if __name__ == "__main__":  # pragma: no cover
    main()
