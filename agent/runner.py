"""Cycle runner: snapshot -> decide -> risk-gate -> execute -> record.

The executor never uses market orders. Sells start near mid and walk toward
the bid across reprices; buys start near mid and walk toward the ask. Every
order passes the RiskGate immediately before placement.
"""
from __future__ import annotations

import logging
import time
from decimal import Decimal
from typing import Optional

from .config import AgentConfig, UnderlyingConfig
from .state import StateStore
from .strategy.covered_call import Intent, IntentKind, Side, Snapshot, decide
from .strategy.risk import RiskGate
from .venues.base import OptionQuote, OrderState, Venue

log = logging.getLogger("overwrite")


def _limit_price(q: OptionQuote, side: Side, step: int, aggression: Decimal) -> Decimal:
    """Price ladder: step 0 near mid, walking toward the touch each reprice."""
    if q.bid is None or q.ask is None:
        raise ValueError("no two-sided book")
    mid = (q.bid + q.ask) / 2
    span = (q.ask - q.bid) / 2
    frac = min(Decimal(1), aggression * (step + 1))
    px = mid - span * frac if side == Side.SELL else mid + span * frac
    # snap to tick DIRECTIONALLY: a sell rounds down, a buy rounds up, so the
    # final ladder step (the touch) is guaranteed to actually cross.
    import decimal

    tick = q.tick_size or Decimal("0.0001")
    rounding = decimal.ROUND_FLOOR if side == Side.SELL else decimal.ROUND_CEILING
    return (px / tick).to_integral_value(rounding=rounding) * tick


def snapshot_for(venue: Venue, ucfg: UnderlyingConfig) -> Snapshot:
    chain = venue.option_chain(ucfg.symbol)
    # Exact underlying prefix AND call options only. Prefix/startswith matching
    # is forbidden here: "SOL" must not match "SOLVBTC-...", and a short PUT
    # must never be treated as a short call (it neither consumes call coverage
    # nor should it be bought back by call-management rules).
    positions = [
        p for p in venue.positions()
        if p.instrument_name.split("-")[0] == ucfg.symbol
        and p.instrument_name.split("-")[-1] == "C"
    ]
    # Balances: exact asset-name match against the venue's declared collateral
    # aliases (e.g. ETH/WETH on Derive). Never startswith: "ETHENA" != ETH.
    allowed = {a.upper() for a in venue.collateral_assets(ucfg.symbol)}
    held = sum(
        (b.amount for b in venue.balances() if b.asset.upper() in allowed),
        Decimal(0),
    )
    return Snapshot(
        underlying=ucfg.symbol,
        spot=venue.spot(ucfg.symbol),
        chain=chain,
        short_calls=[p for p in positions if p.amount < 0],
        held_units=held,
        now_ts=venue.now(),
    )


class Executor:
    def __init__(self, cfg: AgentConfig, venue: Venue, state: StateStore) -> None:
        self.cfg = cfg
        self.venue = venue
        self.state = state
        # per-execute() results, readable by the caller (roll leg-2 credit check
        # and outstanding-shorts accounting need the ACTUAL fill, not the intent)
        self.last_filled_amount: Decimal = Decimal(0)
        self.last_fill_price: Optional[Decimal] = None

    def _final_status(self, instrument: str, order_id: str,
                      fallback: "OrderResult") -> "OrderResult":
        """Best-effort status re-read; on error keep what we last saw."""
        try:
            return self.venue.order_status(instrument, order_id)
        except Exception as exc:  # fail closed: assume no further fills
            log.warning("order_status failed for %s/%s: %r",
                        instrument, order_id, exc)
            return fallback

    def execute(self, intent: Intent) -> Optional[OrderState]:
        ex = self.cfg.execution
        q = intent.quote
        remaining = intent.amount
        self.last_filled_amount = Decimal(0)
        self.last_fill_price = None

        for step in range(ex.max_reprices + 1):
            px = _limit_price(q, intent.side, step, ex.aggression)
            try:
                res = self.venue.place_limit(
                    instrument_name=intent.instrument_name,
                    side=intent.side,
                    amount=remaining,
                    limit_price=px,
                    label=f"ow:{intent.kind.value}",
                    post_only=ex.post_only and step == 0,
                    reduce_only=intent.kind == IntentKind.BUY_BACK,
                )
            except Exception as exc:
                # venue error (e.g. post-only would cross, API hiccup): fail
                # closed for this intent - never blind-fire replacements.
                log.warning("place_limit failed: %s: %r",
                            intent.instrument_name, exc)
                self.state.record_order(
                    self.venue.name, intent.instrument_name, intent.side.value,
                    remaining, px, "error", None,
                    f"{intent.reason} | place failed: {exc!r}",
                )
                break
            final = res
            if res.state == OrderState.REJECTED:
                log.warning("order rejected: %s", intent.instrument_name)
                self.state.record_order(
                    self.venue.name, intent.instrument_name, intent.side.value,
                    remaining, px, "rejected", res.order_id, intent.reason,
                )
                if self.last_filled_amount > 0:
                    return OrderState.PARTIAL
                return OrderState.REJECTED
            if res.state not in (OrderState.FILLED, OrderState.CANCELLED):
                # open/partial: wait for fill_timeout, then cancel and re-read
                # status ONCE MORE - the order can fill in the cancel race and
                # that fill must be accounted for, or the next reprice would
                # double-place and (for sells) break the covered invariant.
                deadline = time.time() + ex.fill_timeout_sec
                while time.time() < deadline:
                    time.sleep(min(2.0, ex.fill_timeout_sec / 6))
                    final = self._final_status(
                        intent.instrument_name, res.order_id, final)
                    if final.state in (OrderState.FILLED, OrderState.CANCELLED,
                                       OrderState.REJECTED):
                        break
                if final.state not in (OrderState.FILLED, OrderState.CANCELLED,
                                       OrderState.REJECTED):
                    try:
                        self.venue.cancel(intent.instrument_name, res.order_id)
                    except Exception as exc:
                        log.warning("cancel failed for %s: %r",
                                    intent.instrument_name, exc)
                    final = self._final_status(
                        intent.instrument_name, res.order_id, final)
            # account whatever this order actually filled (full or partial)
            filled = final.filled_amount or Decimal(0)
            if final.state == OrderState.FILLED and filled <= 0:
                filled = remaining
            filled = min(filled, remaining)
            if filled > 0:
                price = final.average_fill_price or px
                self._record_fill(intent, price, filled)
                remaining -= filled
            if remaining <= 0:
                return OrderState.FILLED
            log.info(
                "reprice %d/%d %s %s (remaining %s)", step + 1, ex.max_reprices,
                intent.side.value, intent.instrument_name, remaining,
            )
        log.info("unfilled after reprices: %s (remaining %s)",
                 intent.instrument_name, remaining)
        if self.last_filled_amount > 0:
            return OrderState.PARTIAL
        return OrderState.CANCELLED

    def _record_fill(self, intent: Intent, price: Decimal, amount: Decimal) -> None:
        self.state.record_order(
            self.venue.name, intent.instrument_name, intent.side.value,
            amount, price, "filled", None, intent.reason, price,
        )
        usd = price * amount
        kind = "premium_in" if intent.side == Side.SELL else "buyback_out"
        self.state.record_ledger(intent.underlying, intent.instrument_name, kind, usd)
        # aggregate per-execute() fill stats for the caller
        prev_amt = self.last_filled_amount
        prev_px = self.last_fill_price
        if prev_px is None or prev_amt <= 0:
            self.last_fill_price = price
        else:
            self.last_fill_price = (prev_px * prev_amt + price * amount) / (
                prev_amt + amount
            )
        self.last_filled_amount = prev_amt + amount
        log.info(
            "FILLED %s %s %s @ %s (%s)", intent.side.value, amount,
            intent.instrument_name, price, intent.reason,
        )


def run_cycle(cfg: AgentConfig, venue: Venue, state: StateStore) -> dict:
    gate = RiskGate(cfg, state)
    executor = Executor(cfg, venue, state)
    summary: dict = {"venue": venue.name, "dry_run": cfg.dry_run, "underlyings": {}}

    margin = venue.margin()
    equity = margin.total_value
    state.record_equity(equity)

    for ucfg in cfg.underlyings:
        if not ucfg.enabled:
            continue
        entry: dict = {"intents": [], "executed": [], "vetoed": []}
        try:
            snap = snapshot_for(venue, ucfg)
        except KeyError as exc:
            entry["error"] = f"not listed on venue yet: {exc}"
            summary["underlyings"][ucfg.symbol] = entry
            continue
        except Exception as exc:
            entry["error"] = repr(exc)
            summary["underlyings"][ucfg.symbol] = entry
            continue

        intents = decide(snap, ucfg)
        outstanding = sum(
            (-p.amount for p in snap.short_calls if p.amount < 0), Decimal(0)
        )
        for intent in intents:
            entry["intents"].append(intent.reason)
            try:
                px = _limit_price(intent.quote, intent.side, 0, cfg.execution.aggression)
            except ValueError as exc:
                entry["vetoed"].append(f"{intent.instrument_name}: {exc}")
                continue
            verdict = gate.check(
                intent, px, margin, equity, snap.held_units, outstanding
            )
            if not verdict.allowed:
                entry["vetoed"].append(f"{intent.instrument_name}: {verdict.reason}")
                state.record_order(
                    venue.name, intent.instrument_name, intent.side.value,
                    intent.amount, px, "vetoed", None, verdict.reason,
                )
                continue
            if cfg.dry_run:
                entry["executed"].append(f"DRY-RUN {intent.side.value} "
                                         f"{intent.amount} {intent.instrument_name}")
                log.info("DRY-RUN: would %s %s %s (%s)", intent.side.value,
                         intent.amount, intent.instrument_name, intent.reason)
                continue
            result = executor.execute(intent)
            leg1_filled = executor.last_filled_amount
            leg1_price = executor.last_fill_price
            entry["executed"].append(
                f"{intent.side.value} {intent.amount} "
                f"{intent.instrument_name} -> {result}"
            )
            # account ACTUAL fills (partials included) against coverage
            if intent.side == Side.SELL:
                outstanding += leg1_filled
            else:
                outstanding -= leg1_filled
            if result == OrderState.FILLED and intent.side == Side.BUY:
                # roll second leg: replacement sell (defensive roll)
                if intent.replacement is not None:
                    repl = intent.replacement
                    px2 = _limit_price(repl, Side.SELL, 0, cfg.execution.aggression)
                    # net-credit re-check against the ACTUAL leg-1 cost: the
                    # replacement quote may have gone stale between snapshot
                    # and now - a credit roll must never become a debit roll.
                    if leg1_price is not None and px2 < leg1_price:
                        entry["vetoed"].append(
                            f"{repl.instrument_name}: roll no longer net-credit"
                            f" (sell {px2} < buyback {leg1_price})"
                        )
                    else:
                        sell = Intent(
                            IntentKind.SELL_CALL, intent.underlying,
                            repl.instrument_name, Side.SELL, intent.amount, repl,
                            f"defensive roll leg 2 (was {intent.instrument_name})",
                        )
                        v2 = gate.check(sell, px2, margin, equity,
                                        snap.held_units, outstanding)
                        if v2.allowed:
                            r2 = executor.execute(sell)
                            entry["executed"].append(
                                f"sell {intent.amount} {repl.instrument_name} -> {r2}"
                            )
                            outstanding += executor.last_filled_amount
                        else:
                            entry["vetoed"].append(
                                f"{repl.instrument_name}: {v2.reason}"
                            )
        summary["underlyings"][ucfg.symbol] = entry

    state.record_cycle(summary)
    return summary
