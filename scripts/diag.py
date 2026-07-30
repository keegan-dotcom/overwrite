"""One-shot diagnostic: what does the agent see on Derive right now?

Usage (from repo root, venv active, .env loaded):
    python3 scripts/diag.py
Prints balances, spot, chain size, and why the agent is or isn't selling.
Contains no secrets in its output.
"""
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent.config import load_config                      # noqa: E402
from agent.main import build_venue                        # noqa: E402
from agent.runner import snapshot_for                     # noqa: E402
from agent.strategy.covered_call import decide, select_call_to_sell  # noqa: E402


def main() -> None:
    cfg = load_config("configs/config.example.yaml")
    venue = build_venue(cfg)

    print("=== balances in subaccount ===")
    for b in venue.balances():
        print(f"  {b.asset:12s} amount={b.amount}  (~${b.mark_value_usd})")

    m = venue.margin()
    print(f"=== margin ===  value=${m.total_value}  maint={m.maintenance_margin}"
          f"  usage={m.maintenance_usage:.1%}")

    for u in cfg.underlyings:
        if not u.enabled:
            continue
        print(f"\n=== {u.symbol} ===")
        try:
            s = snapshot_for(venue, u)
        except Exception:
            traceback.print_exc()
            continue
        calls = [q for q in s.chain if q.option_type.value == "C"]
        bid_calls = [q for q in calls if q.bid]
        in_window = [
            q for q in bid_calls
            if u.dte_min <= q.dte(s.now_ts) <= u.dte_max
            and u.delta_min <= q.delta <= u.delta_max
        ]
        print(f"  spot={s.spot}  held_units={s.held_units}  "
              f"short_calls={len(s.short_calls)}")
        print(f"  chain: {len(s.chain)} instruments, {len(calls)} calls, "
              f"{len(bid_calls)} with bids, {len(in_window)} in delta/DTE window")
        pick = select_call_to_sell(s, u)
        if pick:
            print(f"  taker pick: {pick.instrument_name} delta={pick.delta} "
                  f"bid={pick.bid} ask={pick.ask}")
        else:
            print("  taker mode: nothing passes filters", end="")
            if s.held_units <= 0:
                print("  <-- AND held_units=0: no base collateral to cover calls")
            else:
                print()
        mpick = select_call_to_sell(s, u, maker=True)
        if mpick:
            print(f"  MAKER pick: {mpick.instrument_name} delta={mpick.delta} "
                  f"mark={mpick.mark} (would rest post-only at mark)")
        else:
            print("  maker mode: nothing passes filters either")
        maker_on = cfg.execution.maker_mode
        intents = decide(s, u, maker=maker_on)
        print(f"  decide(maker={maker_on}) -> {len(intents)} intent(s): "
              f"{[i.reason for i in intents]}")


if __name__ == "__main__":
    main()
