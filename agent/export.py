"""status.json exporter - the public track-record feed.

Writes a small JSON snapshot of agent state that the web dashboard
(web/src/pages/Dashboard.tsx) renders when served as /status.json.
Runs offline from the state DB; if a live venue is provided (as in the
`run` loop), current positions are included too.

No secrets: only market data, aggregates and instrument names.
"""
from __future__ import annotations

import calendar
import json
import time
from decimal import Decimal
from pathlib import Path
from typing import Optional

from .config import AgentConfig
from .state import StateStore
from .venues.base import Venue


def _dte_from_name(name: str, now: float) -> Optional[float]:
    try:
        day = name.split("-")[1]
        exp = calendar.timegm(time.strptime(day, "%Y%m%d")) + 8 * 3600
        return round(max(0.0, (exp - now) / 86400.0), 1)
    except Exception:
        return None


def build_status(
    cfg: AgentConfig, state: StateStore, venue: Optional[Venue] = None
) -> dict:
    now = time.time()
    status: dict = {
        "generated_at": int(now),
        "venue": cfg.venue,
        "environment": cfg.derive.environment if cfg.venue == "derive" else "sim",
        "dry_run": cfg.dry_run,
        "premium_total_usd": float(state.premium_collected()),
        "premium_30d_usd": float(state.premium_collected(now - 30 * 86400)),
        "orders_24h": state.orders_last_24h(),
        "equity_hwm_usd": (
            float(state.equity_high_water())
            if state.equity_high_water() is not None else None
        ),
        "ledger": [
            {
                "ts": time.strftime("%m-%d %H:%M", time.localtime(r["ts"])),
                "kind": r["kind"],
                "instrument": r["instrument"],
                "usd": round(float(r["amount_usd"]), 2),
            }
            for r in state.recent_ledger(20)
        ],
        "cycles": [],
        "positions": [],
    }

    for c in state.last_cycles(6):
        ts = time.strftime("%H:%M:%S", time.localtime(c.get("ts", now)))
        for sym, entry in (c.get("underlyings") or {}).items():
            for line in entry.get("executed", []) or []:
                status["cycles"].append({"ts": ts, "msg": f"{sym}: {line}"})
            for line in entry.get("vetoed", []) or []:
                status["cycles"].append({"ts": ts, "msg": f"{sym}: VETO {line}"})
            if not entry.get("executed") and not entry.get("vetoed"):
                status["cycles"].append({"ts": ts, "msg": f"{sym}: idle"})
    status["cycles"] = status["cycles"][:14]

    if venue is not None:
        try:
            for p in venue.positions():
                if p.amount == 0:
                    continue
                status["positions"].append({
                    "instrument": p.instrument_name,
                    "size": float(p.amount),
                    "entry": float(p.average_price),
                    "mark": float(p.mark_price),
                    "delta": float(p.delta),
                    "dte": _dte_from_name(p.instrument_name, now),
                })
        except Exception:
            pass  # never let the exporter break a trading cycle

    return status


def export_status(
    cfg: AgentConfig, state: StateStore, venue: Optional[Venue] = None,
    path: Optional[str] = None,
) -> Optional[str]:
    """Write status.json; returns the path written or None if disabled."""
    out = path or cfg.status_export
    if not out:
        return None
    p = Path(out)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(build_status(cfg, state, venue), indent=1))
    return str(p)
