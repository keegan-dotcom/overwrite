"""Risk rails.

Every intent produced by the strategy passes through RiskGate before it can
reach a venue. The gate is deliberately paranoid and fails CLOSED: any error
in evaluating a rule vetoes the order.

Layers (in order):
  0. dry-run           - log intent, never trade
  1. kill switch       - file exists => veto everything, forever, loudly
  2. pause file        - file exists => veto new risk (buy-backs still allowed)
  3. margin buffer     - no NEW risk above max maintenance usage
  4. drawdown pause    - no NEW risk below high-water equity threshold
  5. order rate limit  - max orders per rolling day
  6. price sanity      - limit price near mark, quote fresh, book present
  7. coverage          - re-verify the covered invariant at the venue snapshot
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Optional

from ..config import AgentConfig
from ..venues.base import MarginSummary, OptionQuote, Side
from .covered_call import Intent, IntentKind


@dataclass(frozen=True)
class Verdict:
    allowed: bool
    reason: str

    @classmethod
    def ok(cls) -> "Verdict":
        return cls(True, "ok")

    @classmethod
    def veto(cls, why: str) -> "Verdict":
        return cls(False, why)


class RiskGate:
    def __init__(self, cfg: AgentConfig, state) -> None:
        self.cfg = cfg
        self.state = state  # agent.state.StateStore

    # ---- individual rules --------------------------------------------------

    def _kill_switch(self) -> Optional[str]:
        if Path(self.cfg.risk.kill_switch_file).exists():
            return f"KILL SWITCH present at {self.cfg.risk.kill_switch_file}"
        return None

    def _paused(self) -> bool:
        return Path(self.cfg.risk.pause_file).exists()

    def _price_sane(self, intent: Intent, limit_price: Decimal) -> Optional[str]:
        q: OptionQuote = intent.quote
        age = time.time() - q.timestamp
        if age > self.cfg.risk.max_quote_age_sec:
            return f"quote stale: {age:.0f}s old"
        if q.mark <= 0:
            return "non-positive mark"
        if q.bid is None or q.ask is None:
            # maker mode may quote into an empty/one-sided book - but only
            # post-only at/near mark, which the deviation check below bounds.
            if not self.cfg.execution.maker_mode:
                return "one-sided or empty book"
        dev = abs(limit_price - q.mark) / q.mark
        if dev > self.cfg.risk.max_price_dev_from_mark:
            return f"limit {limit_price} deviates {dev:.1%} from mark {q.mark}"
        if (intent.side == Side.SELL and q.bid is not None
                and limit_price < q.bid * Decimal("0.5")):
            return "sell limit below half of bid - refusing to give premium away"
        return None

    # ---- the gate -----------------------------------------------------------

    def check(
        self,
        intent: Intent,
        limit_price: Decimal,
        margin: MarginSummary,
        equity: Decimal,
        held_units: Decimal,
        outstanding_short: Decimal,
    ) -> Verdict:
        try:
            return self._check(
                intent, limit_price, margin, equity, held_units, outstanding_short
            )
        except Exception as exc:  # fail CLOSED
            return Verdict.veto(f"risk rule error ({exc!r}) - failing closed")

    def _check(
        self,
        intent: Intent,
        limit_price: Decimal,
        margin: MarginSummary,
        equity: Decimal,
        held_units: Decimal,
        outstanding_short: Decimal,
    ) -> Verdict:
        kill = self._kill_switch()
        if kill:
            return Verdict.veto(kill)

        opens_risk = intent.kind == IntentKind.SELL_CALL

        if self._paused() and opens_risk:
            return Verdict.veto("paused (pause file present); buy-backs only")

        if opens_risk and margin.maintenance_usage > self.cfg.risk.max_maintenance_usage:
            return Verdict.veto(
                f"maintenance usage {margin.maintenance_usage:.1%} > "
                f"{self.cfg.risk.max_maintenance_usage:.0%}"
            )

        if opens_risk:
            hwm = self.state.equity_high_water()
            if hwm and hwm > 0 and equity > 0:
                dd = (hwm - equity) / hwm
                if dd > self.cfg.risk.max_drawdown_pause:
                    return Verdict.veto(
                        f"drawdown {dd:.1%} > {self.cfg.risk.max_drawdown_pause:.0%}; "
                        "new sells paused"
                    )

        # Budget applies to risk-OPENING orders only: buy-backs reduce risk and
        # must never be pinned by a rate limit (audit finding M5).
        if opens_risk and self.state.orders_last_24h() >= self.cfg.risk.max_orders_per_day:
            return Verdict.veto("daily order budget exhausted")

        px = self._price_sane(intent, limit_price)
        if px:
            return Verdict.veto(px)

        if opens_risk:
            if outstanding_short + intent.amount > held_units:
                return Verdict.veto(
                    f"COVERAGE VIOLATION: short {outstanding_short} + "
                    f"{intent.amount} would exceed held {held_units}"
                )

        return Verdict.ok()
