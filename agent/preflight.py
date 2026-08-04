"""Guided go-live preflight — the activation gate.

    python -m agent.main preflight --config configs/config.example.yaml

Runs every check the agent depends on (config, env, risk files, venue
connectivity, margin, balances, option chains) and, if nothing FAILs,
writes a PREFLIGHT_OK stamp next to the state DB. `run`/`once`/`close-all`
with --live refuse to start unless the stamp is fresher than 24h
(escape hatch: --skip-preflight).

Two-stage go-live: dry-run is the default; --live only works after a
guided inspection has blessed the setup. A config change or venue switch
should be followed by a fresh preflight.
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Callable, Optional

from .config import AgentConfig

STAMP_MAX_AGE_SEC = 24 * 3600
_ENV_KEYS = ("DERIVE_WALLET", "DERIVE_SESSION_KEY", "DERIVE_SUBACCOUNT_ID")


@dataclass(frozen=True)
class Check:
    name: str
    level: str  # "pass" | "warn" | "fail"
    detail: str


def stamp_path(cfg: AgentConfig) -> Path:
    return Path(cfg.state_db).parent / "PREFLIGHT_OK"


def stamp_fresh(cfg: AgentConfig, max_age: float = STAMP_MAX_AGE_SEC) -> bool:
    p = stamp_path(cfg)
    if not p.exists():
        return False
    try:
        data = json.loads(p.read_text())
        return time.time() - float(data.get("ts", 0)) < max_age
    except Exception:
        return False


def write_stamp(cfg: AgentConfig, checks: list[Check]) -> Path:
    p = stamp_path(cfg)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({
        "ts": time.time(),
        "venue": cfg.venue,
        "dry_run": cfg.dry_run,
        "warns": [c.name for c in checks if c.level == "warn"],
    }, indent=2))
    return p


def run_preflight(cfg: AgentConfig, venue_factory: Callable[[AgentConfig], object]) -> list[Check]:
    checks: list[Check] = []
    add = lambda name, level, detail: checks.append(Check(name, level, detail))  # noqa: E731

    # -- config ------------------------------------------------------------
    enabled = [u for u in cfg.underlyings if u.enabled]
    if enabled:
        add("config", "pass",
            f"{len(enabled)} underlying(s) enabled: {', '.join(u.symbol for u in enabled)}")
    else:
        add("config", "fail", "no underlyings enabled in config")
    add("mode", "pass" if cfg.dry_run else "warn",
        "dry_run ON (safe default)" if cfg.dry_run
        else "dry_run OFF — a --live run after this preflight places REAL orders")

    # -- environment (derive) ---------------------------------------------
    if cfg.venue == "derive":
        missing = [k for k in _ENV_KEYS if not os.environ.get(k)]
        if missing:
            add("env", "fail",
                f"missing {', '.join(missing)} — populate .env then `set -a; source .env; set +a`")
        else:
            add("env", "pass", "wallet / session key / subaccount id present")

    # -- risk files --------------------------------------------------------
    for label, f in (("kill-switch", cfg.risk.kill_switch_file),
                     ("pause-file", cfg.risk.pause_file)):
        if Path(f).exists():
            add(label, "warn", f"{f} PRESENT — trading blocked/limited until removed")
        else:
            add(label, "pass", f"{f} absent")

    # -- data dir writable -------------------------------------------------
    try:
        d = Path(cfg.state_db).parent
        d.mkdir(parents=True, exist_ok=True)
        probe = d / ".preflight_probe"
        probe.write_text("ok")
        probe.unlink()
        add("data-dir", "pass", f"{d} writable")
    except Exception as exc:  # pragma: no cover - env specific
        add("data-dir", "fail", f"state dir not writable: {exc!r}")

    # -- venue connectivity ------------------------------------------------
    venue = None
    try:
        venue = venue_factory(cfg)
        add("venue", "pass", f"connected: {cfg.venue}"
            + (f" ({cfg.derive.environment})" if cfg.venue == "derive" else ""))
    except Exception as exc:
        add("venue", "fail", f"cannot connect: {exc!r}")

    if venue is None:
        return checks

    # -- margin ------------------------------------------------------------
    margin = None
    try:
        margin = venue.margin()
        usage = margin.maintenance_usage
        ok = usage <= cfg.risk.max_maintenance_usage
        add("margin", "pass" if ok else "fail",
            f"equity ${margin.total_value:,.2f} · maintenance usage {usage * 100:.1f}%"
            f" (ceiling {cfg.risk.max_maintenance_usage * 100:.0f}%)")
    except Exception as exc:
        add("margin", "fail", f"margin fetch failed: {exc!r}")

    # -- balances cover enabled underlyings --------------------------------
    balances: dict[str, Decimal] = {}
    try:
        balances = {b.asset: b.amount for b in venue.balances()}
        add("balances", "pass",
            ", ".join(f"{a}: {amt}" for a, amt in balances.items()) or "none")
    except Exception as exc:
        add("balances", "fail", f"balance fetch failed: {exc!r}")

    for u in enabled:
        try:
            coll = venue.collateral_assets(u.symbol)
        except Exception:
            coll = (u.symbol,)
        held = sum((balances.get(a, Decimal(0)) for a in coll), Decimal(0))
        if held > 0:
            add(f"holdings:{u.symbol}", "pass", f"{held} across {'/'.join(coll)}")
        else:
            add(f"holdings:{u.symbol}", "warn",
                f"no {'/'.join(coll)} balance — nothing to cover calls with")

    # -- market data per enabled underlying --------------------------------
    for u in enabled:
        try:
            spot = venue.spot(u.symbol)
            if spot <= 0:
                add(f"market:{u.symbol}", "fail", f"spot returned {spot}")
                continue
            chain = venue.option_chain(u.symbol)
            in_window = [q for q in chain
                         if u.dte_min <= q.dte(venue.now()) <= u.dte_max]
            if in_window:
                add(f"market:{u.symbol}", "pass",
                    f"spot ${spot:,.2f} · {len(chain)} quotes, {len(in_window)} in "
                    f"{u.dte_min}-{u.dte_max}d window")
            else:
                add(f"market:{u.symbol}", "warn",
                    f"spot ${spot:,.2f} · no strikes inside the {u.dte_min}-{u.dte_max}d "
                    "DTE window (agent will idle until one exists)")
        except Exception as exc:
            add(f"market:{u.symbol}", "fail", f"chain/spot fetch failed: {exc!r}")

    return checks


_ICON = {"pass": "✓", "warn": "!", "fail": "✗"}


def render(checks: list[Check]) -> str:
    lines = [f" {_ICON[c.level]} {c.name:<16} {c.detail}" for c in checks]
    return "\n".join(lines)


def preflight_ok(checks: list[Check]) -> bool:
    return not any(c.level == "fail" for c in checks)
