"""Overwrite agent CLI.

    python -m agent.main run --config configs/config.example.yaml
    python -m agent.main once --config ... [--live]
    python -m agent.main status --config ...
    python -m agent.main close-all --config ... --live

Safety model:
  * dry_run defaults to TRUE in config; `--live` is required ON TOP of
    dry_run: false in YAML to place real orders (belt and suspenders).
  * touch data/KILL to hard-stop all trading; data/PAUSE to stop new sells.
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import logging
import sys
import time
from decimal import Decimal
from pathlib import Path

from .config import AgentConfig, load_config
from .runner import run_cycle
from .state import StateStore
from .venues.base import Venue


def build_venue(cfg: AgentConfig) -> Venue:
    if cfg.venue == "mock":
        from .venues.mock import MockVenue

        return MockVenue(
            spots={"ETH": Decimal("3800"), "BTC": Decimal("98000")},
            ivs={"ETH": Decimal("0.50"), "BTC": Decimal("0.38")},
            holdings={"ETH": Decimal("10"), "BTC": Decimal("0.5")},
        )
    if cfg.venue == "derive":
        from .venues.derive import DeriveVenue

        return DeriveVenue(cfg.derive)
    raise ValueError(cfg.venue)


def _setup_logging(log_dir: str) -> None:
    Path(log_dir).mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(Path(log_dir) / "agent.log"),
        ],
    )


def _effective_config(cfg: AgentConfig, live_flag: bool) -> AgentConfig:
    """dry_run stays on unless BOTH yaml dry_run:false AND --live are given."""
    effective_dry = cfg.dry_run or not live_flag
    return dataclasses.replace(cfg, dry_run=effective_dry)


def cmd_once(cfg: AgentConfig) -> None:
    venue = build_venue(cfg)
    state = StateStore(cfg.state_db)
    summary = run_cycle(cfg, venue, state)
    print(json.dumps(summary, indent=2, default=str))


def cmd_run(cfg: AgentConfig) -> None:
    from .export import export_status

    venue = build_venue(cfg)
    state = StateStore(cfg.state_db)
    log = logging.getLogger("overwrite")
    log.info("starting loop: venue=%s dry_run=%s cycle=%ss",
             cfg.venue, cfg.dry_run, cfg.cycle_seconds)
    while True:
        started = time.time()
        try:
            summary = run_cycle(cfg, venue, state)
            log.info("cycle done: %s", json.dumps(summary, default=str)[:800])
            out = export_status(cfg, state, venue)
            if out:
                log.info("status exported -> %s", out)
        except KeyboardInterrupt:
            raise
        except Exception:
            log.exception("cycle failed; continuing")
        elapsed = time.time() - started
        time.sleep(max(5.0, cfg.cycle_seconds - elapsed))


def cmd_status(cfg: AgentConfig) -> None:
    state = StateStore(cfg.state_db)
    print(json.dumps({
        "premium_collected_usd_total": str(state.premium_collected()),
        "premium_collected_usd_30d": str(
            state.premium_collected(time.time() - 30 * 86400)
        ),
        "orders_last_24h": state.orders_last_24h(),
        "equity_high_water": str(state.equity_high_water()),
        "recent_cycles": state.last_cycles(3),
    }, indent=2, default=str))


def cmd_close_all(cfg: AgentConfig) -> None:
    """Buy back every short call at up to ask (still limit orders).

    Every order still passes the RiskGate (kill switch, price sanity, quote
    freshness, order budget). Buy-backs are exempt from the pause file but NOT
    from the kill switch: `data/KILL` means no orders at all - remove it first
    if you intend to flatten.
    """
    from .strategy.covered_call import Intent, IntentKind, Side
    from .strategy.risk import RiskGate
    from .runner import Executor, _limit_price

    venue = build_venue(cfg)
    state = StateStore(cfg.state_db)
    executor = Executor(cfg, venue, state)
    gate = RiskGate(cfg, state)
    margin = venue.margin()
    equity = margin.total_value
    for p in venue.positions():
        if p.amount >= 0:
            continue
        try:
            chain = venue.option_chain(p.instrument_name.split("-")[0])
        except Exception as exc:
            print(f"no chain for {p.instrument_name} ({exc!r}); skip")
            continue
        q = next((c for c in chain if c.instrument_name == p.instrument_name), None)
        if q is None:
            print(f"no quote for {p.instrument_name}; skip")
            continue
        intent = Intent(IntentKind.BUY_BACK, q.underlying, q.instrument_name,
                        Side.BUY, -p.amount, q, "close-all")
        try:
            px = _limit_price(q, Side.BUY, 0, cfg.execution.aggression)
        except ValueError as exc:
            print(f"no book for {p.instrument_name} ({exc}); skip")
            continue
        verdict = gate.check(intent, px, margin, equity, Decimal(0), Decimal(0))
        if not verdict.allowed:
            print(f"VETO {p.instrument_name}: {verdict.reason}")
            continue
        if cfg.dry_run:
            print(f"DRY-RUN close {p.instrument_name} x{-p.amount}")
        else:
            print(f"closing {p.instrument_name} x{-p.amount} ->",
                  executor.execute(intent))


def cmd_export_status(cfg: AgentConfig, out: str | None) -> None:
    """Offline status.json export from the state DB (positions omitted)."""
    from .export import export_status

    state = StateStore(cfg.state_db)
    path = export_status(cfg, state, venue=None,
                         path=out or cfg.status_export or "web/public/status.json")
    print(f"wrote {path}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="overwrite")
    ap.add_argument("command",
                    choices=["run", "once", "status", "close-all",
                             "export-status"])
    ap.add_argument("--config", default="configs/config.example.yaml")
    ap.add_argument("--out", default=None,
                    help="output path for export-status")
    ap.add_argument("--live", action="store_true",
                    help="allow real orders (requires dry_run: false in YAML too)")
    args = ap.parse_args(argv)

    cfg = load_config(args.config)
    cfg = _effective_config(cfg, args.live)
    _setup_logging(cfg.log_dir)

    if args.command == "run":
        cmd_run(cfg)
    elif args.command == "once":
        cmd_once(cfg)
    elif args.command == "status":
        cmd_status(cfg)
    elif args.command == "close-all":
        cmd_close_all(cfg)
    elif args.command == "export-status":
        cmd_export_status(cfg, args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
