"""Covered-call decision engine.

Pure logic: takes a snapshot of the world (chain, positions, balances) and
returns a list of intents. Execution, risk-gating and persistence happen
elsewhere. Keeping this pure makes it exhaustively testable.

Core invariant (enforced here AND rechecked by risk rails):
    total short calls per underlying  <=  held units * max_utilization
The agent never sells an uncovered call.

Management rules (mirrors the validated backtest engine):
  1. settlement is European/cash-settled on Derive: nothing to do at expiry,
     capacity simply frees up.
  2. roll at <= roll_dte (gamma/pin territory) - buy back; re-sell next cycle.
  3. take-profit: buy back once premium has decayed by take_profit_pct.
  4. defensive: if |delta| >= defensive_delta, attempt a credit-only roll that
     ALSO de-risks (new delta <= old delta - improvement). A credit-only roll
     that doesn't reduce delta just churns fees in a rally - the backtest
     showed a naive credit-only rule re-fires ~80x/yr in a moon scenario.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from decimal import ROUND_DOWN, Decimal
from enum import Enum
from typing import Optional

from ..config import UnderlyingConfig
from ..venues.base import OptionQuote, OptionType, Position, Side
from .greeks import annualized_premium_yield


class IntentKind(str, Enum):
    SELL_CALL = "sell_call"        # open new short call
    BUY_BACK = "buy_back"          # close existing short (roll/TP/defense step 1)


@dataclass(frozen=True)
class Intent:
    kind: IntentKind
    underlying: str
    instrument_name: str
    side: Side
    amount: Decimal
    quote: OptionQuote
    reason: str
    # for defensive rolls: the buy-back leg carries the replacement so the
    # executor can enforce net-credit atomicity (leg2 only after leg1 fills,
    # and only if leg2 premium still >= leg1 cost).
    replacement: Optional[OptionQuote] = None


@dataclass(frozen=True)
class Snapshot:
    underlying: str
    spot: Decimal
    chain: list[OptionQuote]
    short_calls: list[Position]        # this underlying's short call positions
    held_units: Decimal                # base-asset units in subaccount
    now_ts: float


def _round_step(amount: Decimal, step: Decimal) -> Decimal:
    if step <= 0:
        return amount
    return (amount / step).to_integral_value(rounding=ROUND_DOWN) * step


def _is_call(q: OptionQuote) -> bool:
    return q.option_type == OptionType.CALL


def _quote_for(chain: list[OptionQuote], name: str) -> Optional[OptionQuote]:
    for q in chain:
        if q.instrument_name == name:
            return q
    return None


def select_call_to_sell(
    snap: Snapshot, cfg: UnderlyingConfig
) -> Optional[OptionQuote]:
    """Pick the best call to sell, or None if nothing passes the filters."""
    candidates: list[tuple[Decimal, Decimal, OptionQuote]] = []
    for q in snap.chain:
        if not _is_call(q):
            continue
        dte = Decimal(str(q.dte(snap.now_ts)))
        if not (cfg.dte_min <= dte <= cfg.dte_max):
            continue
        if q.bid is None or q.bid <= 0 or q.ask is None:
            continue
        if not (cfg.delta_min <= q.delta <= cfg.delta_max):
            continue
        sp = q.spread_pct
        if sp is None or sp > cfg.max_spread_pct:
            continue
        if q.open_interest < cfg.min_open_interest:
            continue
        y = Decimal(
            str(
                annualized_premium_yield(
                    float(q.bid), float(snap.spot), float(dte)
                )
            )
        )
        if y < cfg.min_annualized_yield:
            continue
        # rank: closeness to delta target first, then closeness to DTE target
        delta_err = abs(q.delta - cfg.delta_target)
        dte_err = abs(dte - cfg.dte_target) / Decimal(100)
        candidates.append((delta_err, dte_err, q))
    if not candidates:
        return None
    candidates.sort(key=lambda t: (t[0], t[1]))
    return candidates[0][2]


def find_credit_deriser(
    snap: Snapshot, cfg: UnderlyingConfig, pos: Position, held_quote: OptionQuote
) -> Optional[OptionQuote]:
    """Find a replacement call whose bid >= buyback ask (net credit) AND whose
    delta improves on the current one by at least `defensive_delta_improvement`.
    """
    if held_quote.ask is None:
        return None
    buyback_cost = held_quote.ask
    best: Optional[OptionQuote] = None
    for q in snap.chain:
        if not _is_call(q) or q.instrument_name == pos.instrument_name:
            continue
        dte = Decimal(str(q.dte(snap.now_ts)))
        if not (cfg.dte_min <= dte <= cfg.dte_max):
            continue
        if q.bid is None or q.bid < buyback_cost:          # must be net credit
            continue
        if q.delta > held_quote.delta - cfg.defensive_delta_improvement:
            continue                                        # must de-risk
        sp = q.spread_pct
        if sp is None or sp > cfg.max_spread_pct:
            continue
        if best is None or q.delta < best.delta:
            best = q
    return best


def decide(snap: Snapshot, cfg: UnderlyingConfig) -> list[Intent]:
    """One decision pass for one underlying. Returns ordered intents."""
    intents: list[Intent] = []
    now = snap.now_ts or time.time()

    # -- 1. manage existing shorts ------------------------------------------
    managed_away = Decimal(0)  # contracts being bought back this pass
    for pos in snap.short_calls:
        if pos.amount >= 0:
            continue  # not short; ignore (someone manually bought calls?)
        q = _quote_for(snap.chain, pos.instrument_name)
        if q is None:
            continue  # expired/settling - capacity frees automatically
        size = -pos.amount
        dte = q.dte(now)

        # take-profit: premium decayed enough (mark vs our average sale price)
        if pos.average_price > 0 and q.mark <= pos.average_price * (
            Decimal(1) - cfg.take_profit_pct
        ):
            intents.append(
                Intent(
                    IntentKind.BUY_BACK, snap.underlying, pos.instrument_name,
                    Side.BUY, size, q,
                    f"take-profit: mark {q.mark} <= "
                    f"{(1 - cfg.take_profit_pct)} x entry {pos.average_price}",
                )
            )
            managed_away += size
            continue

        # roll window: too close to expiry
        if dte <= cfg.roll_dte:
            intents.append(
                Intent(
                    IntentKind.BUY_BACK, snap.underlying, pos.instrument_name,
                    Side.BUY, size, q,
                    f"roll: {dte:.1f} DTE <= roll_dte {cfg.roll_dte}",
                )
            )
            managed_away += size
            continue

        # defensive: breached delta - only if we can do a credit de-risking roll
        if q.delta >= cfg.defensive_delta:
            repl = find_credit_deriser(snap, cfg, pos, q)
            if repl is not None:
                intents.append(
                    Intent(
                        IntentKind.BUY_BACK, snap.underlying, pos.instrument_name,
                        Side.BUY, size, q,
                        f"defensive roll: delta {q.delta} >= {cfg.defensive_delta}, "
                        f"credit roll to {repl.instrument_name}",
                        replacement=repl,
                    )
                )
                managed_away += size
            # else: hold to settlement - selling more or debit-rolling is worse.

    # -- 2. open new shorts if capacity remains ------------------------------
    outstanding = sum((-p.amount for p in snap.short_calls if p.amount < 0), Decimal(0))
    outstanding -= managed_away
    capacity = snap.held_units * cfg.max_utilization - outstanding
    capacity = _round_step(capacity, cfg.min_order)

    if capacity >= cfg.min_order:
        q = select_call_to_sell(snap, cfg)
        if q is not None:
            amount = min(capacity, cfg.max_order)
            amount = _round_step(amount, max(q.amount_step, cfg.min_order))
            if amount >= max(q.min_amount, cfg.min_order):
                # NEVER exceed coverage even if config is weird
                hard_cap = snap.held_units - outstanding
                amount = min(amount, _round_step(hard_cap, q.amount_step))
                if amount > 0:
                    dte = q.dte(now)
                    y = annualized_premium_yield(
                        float(q.bid or 0), float(snap.spot), dte
                    )
                    intents.append(
                        Intent(
                            IntentKind.SELL_CALL, snap.underlying,
                            q.instrument_name, Side.SELL, amount, q,
                            f"sell {amount} {q.instrument_name} "
                            f"delta={q.delta} dte={dte:.1f} "
                            f"gross_ann_yield={y:.1%}",
                        )
                    )
    return intents
