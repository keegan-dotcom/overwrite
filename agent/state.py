"""SQLite persistence: orders placed, cycles run, premium ledger, equity HWM."""
from __future__ import annotations

import json
import sqlite3
import time
from decimal import Decimal
from pathlib import Path
from typing import Optional

_SCHEMA = """
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    venue TEXT NOT NULL,
    instrument TEXT NOT NULL,
    side TEXT NOT NULL,
    amount TEXT NOT NULL,
    limit_price TEXT NOT NULL,
    state TEXT NOT NULL,
    order_id TEXT,
    reason TEXT,
    fill_price TEXT
);
CREATE TABLE IF NOT EXISTS cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    summary TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    underlying TEXT NOT NULL,
    instrument TEXT NOT NULL,
    kind TEXT NOT NULL,          -- premium_in | buyback_out | settlement
    amount_usd TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS equity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    equity_usd TEXT NOT NULL
);
"""


class StateStore:
    def __init__(self, path: str | Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path))
        self._db.executescript(_SCHEMA)
        self._db.commit()

    # ---- orders -------------------------------------------------------------

    def record_order(
        self,
        venue: str,
        instrument: str,
        side: str,
        amount: Decimal,
        limit_price: Decimal,
        state: str,
        order_id: Optional[str],
        reason: str,
        fill_price: Optional[Decimal] = None,
    ) -> None:
        self._db.execute(
            "INSERT INTO orders (ts, venue, instrument, side, amount, limit_price,"
            " state, order_id, reason, fill_price) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                time.time(), venue, instrument, side, str(amount), str(limit_price),
                state, order_id, reason,
                str(fill_price) if fill_price is not None else None,
            ),
        )
        self._db.commit()

    def orders_last_24h(self) -> int:
        cur = self._db.execute(
            "SELECT COUNT(*) FROM orders WHERE ts > ? AND state != 'vetoed'",
            (time.time() - 86400,),
        )
        return int(cur.fetchone()[0])

    # ---- ledger / equity ------------------------------------------------------

    def record_ledger(
        self, underlying: str, instrument: str, kind: str, amount_usd: Decimal
    ) -> None:
        self._db.execute(
            "INSERT INTO ledger (ts, underlying, instrument, kind, amount_usd)"
            " VALUES (?,?,?,?,?)",
            (time.time(), underlying, instrument, kind, str(amount_usd)),
        )
        self._db.commit()

    def premium_collected(self, since_ts: float = 0.0) -> Decimal:
        cur = self._db.execute(
            "SELECT COALESCE(SUM(CAST(amount_usd AS REAL)),0) FROM ledger"
            " WHERE kind='premium_in' AND ts>=?",
            (since_ts,),
        )
        return Decimal(str(cur.fetchone()[0]))

    def record_equity(self, equity_usd: Decimal) -> None:
        self._db.execute(
            "INSERT INTO equity (ts, equity_usd) VALUES (?,?)",
            (time.time(), str(equity_usd)),
        )
        self._db.commit()

    def equity_high_water(self) -> Optional[Decimal]:
        cur = self._db.execute("SELECT MAX(CAST(equity_usd AS REAL)) FROM equity")
        row = cur.fetchone()
        return Decimal(str(row[0])) if row and row[0] is not None else None

    # ---- cycles ----------------------------------------------------------------

    def record_cycle(self, summary: dict) -> None:
        self._db.execute(
            "INSERT INTO cycles (ts, summary) VALUES (?,?)",
            (time.time(), json.dumps(summary, default=str)),
        )
        self._db.commit()

    def last_cycles(self, n: int = 10) -> list[dict]:
        cur = self._db.execute(
            "SELECT ts, summary FROM cycles ORDER BY id DESC LIMIT ?", (n,)
        )
        return [{"ts": ts, **json.loads(s)} for ts, s in cur.fetchall()]

    def close(self) -> None:
        self._db.close()
