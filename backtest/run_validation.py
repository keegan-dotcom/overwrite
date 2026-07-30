"""Full validation grid for the Overwrite covered-call yield claim.

Runs 6 underlyings x 3 deltas x 2 DTEs x 5 drift scenarios x N Monte Carlo
paths x 1yr and writes:

  backtest/results/validation.json   -- full summary stats per grid cell
  backtest/results/validation.md     -- verdict table + findings
  backtest/results/*.png             -- 3 charts

Usage:
    python -m backtest.run_validation [--paths 2000] [--seed 7]

Common random numbers: each (underlying, drift) pair generates ONE path set
reused across all 6 (delta, dte) engine configs, so config comparisons are
noise-free; drift scenarios per underlying also share a seed sequence.
"""

from __future__ import annotations

import argparse
import json
import time
import zlib
from pathlib import Path

import numpy as np

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from .engine import EngineConfig, run_covered_call, summarize
from .paths import DRIFT_SCENARIOS, UNDERLYINGS, iv_paths, simulate_paths

RESULTS_DIR = Path(__file__).resolve().parent / "results"

DELTAS = [0.15, 0.25, 0.30]
DTES = [30, 45]
CLAIM = 0.10  # "~10% annualized yield"

# Okabe-Ito colorblind-safe palette
OI = {
    "blue": "#0072B2",
    "orange": "#E69F00",
    "green": "#009E73",
    "sky": "#56B4E9",
    "vermillion": "#D55E00",
    "purple": "#CC79A7",
    "yellow": "#F0E442",
    "black": "#000000",
    "grey": "#8C8C8C",
}
UNDERLYING_ORDER = ["SPY", "AAPL", "NVDA", "TSLA", "BTC", "ETH"]

plt.rcParams.update({
    "figure.dpi": 150,
    "font.size": 9,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.alpha": 0.25,
    "grid.linewidth": 0.6,
    "axes.axisbelow": True,
    "legend.frameon": False,
})


def run_grid(n_paths: int = 2000, n_days: int = 365, seed: int = 7,
             verbose: bool = True) -> dict:
    results: dict = {
        "meta": {
            "n_paths": n_paths,
            "horizon_days": n_days,
            "seed": seed,
            "claim_annual_yield": CLAIM,
            "deltas": DELTAS,
            "dtes": DTES,
            "drift_scenarios": DRIFT_SCENARIOS,
            "calibration": {
                name: {
                    "spot": s.spot,
                    "iv30_anchor": s.iv0,
                    "vrp_vol_pts": s.vrp,
                    "longrun_realized_vol": s.rv_longrun,
                    "jump_lambda_per_yr": s.jump_lambda,
                    "jump_mean_log": s.jump_mean,
                    "jump_std_log": s.jump_std,
                }
                for name, s in UNDERLYINGS.items()
            },
            "engine_defaults": vars(EngineConfig()),
        },
        "grid": {},
    }
    t_start = time.time()
    for name in UNDERLYING_ORDER:
        spec = UNDERLYINGS[name]
        results["grid"][name] = {}
        for drift_name, drift in DRIFT_SCENARIOS.items():
            # Common random numbers across engine configs for this cell.
            rng = np.random.default_rng(
                np.random.SeedSequence([seed, zlib.crc32(name.encode()),
                                        zlib.crc32(drift_name.encode())])
            )
            px = simulate_paths(spec, drift, n_paths=n_paths, n_days=n_days,
                                rng=rng)
            iv = iv_paths(px, spec, rng=rng)
            cell: dict = {}
            for delta in DELTAS:
                for dte in DTES:
                    cfg = EngineConfig(target_delta=delta, target_dte=dte)
                    res = run_covered_call(px, iv, cfg)
                    cell[f"d{int(delta*100)}_dte{dte}"] = summarize(
                        res, px, cfg, monthly_target_annual=CLAIM
                    )
            results["grid"][name][drift_name] = cell
            if verbose:
                print(f"  {name} {drift_name}: done "
                      f"({time.time() - t_start:.0f}s elapsed)", flush=True)
    results["meta"]["runtime_seconds"] = round(time.time() - t_start, 1)
    return results


# ---------------------------------------------------------------------------
# Charts
# ---------------------------------------------------------------------------


def chart_premium_yield(results: dict, out: Path) -> None:
    """Annualized quoted premium by underlying x delta (base drift, 30 DTE)."""
    fig, ax = plt.subplots(figsize=(7, 3.6))
    width = 0.26
    colors = [OI["sky"], OI["blue"], OI["vermillion"]]
    x = np.arange(len(UNDERLYING_ORDER))
    for i, delta in enumerate(DELTAS):
        vals = [
            results["grid"][u]["base"][f"d{int(delta*100)}_dte30"][
                "quoted_premium_annualized"] * 100
            for u in UNDERLYING_ORDER
        ]
        ax.bar(x + (i - 1) * width, vals, width, label=f"{delta:.2f} delta",
               color=colors[i])
    ax.axhline(CLAIM * 100, color=OI["black"], lw=1, ls="--")
    ax.text(len(UNDERLYING_ORDER) - 0.45, CLAIM * 100 + 0.8, "10% claim",
            fontsize=8, ha="right")
    ax.set_xticks(x, UNDERLYING_ORDER)
    ax.set_ylabel("Gross premium, % of spot per year")
    ax.set_title("Quoted call premium, annualized (30 DTE, base scenario)",
                 fontsize=10)
    ax.legend(ncol=3, loc="upper left")
    fig.tight_layout()
    fig.savefig(out)
    plt.close(fig)


def chart_return_vs_buyhold(results: dict, out: Path) -> None:
    """CC net total return vs buy-and-hold across drift scenarios."""
    scenarios = list(DRIFT_SCENARIOS)
    fig, axes = plt.subplots(2, 3, figsize=(8.6, 5.2), sharex=True)
    for ax, u in zip(axes.flat, UNDERLYING_ORDER):
        cc = [results["grid"][u][sc]["d30_dte30"]["net_total_return_mean"] * 100
              for sc in scenarios]
        bh = [results["grid"][u][sc]["d30_dte30"]["buyhold_return_mean"] * 100
              for sc in scenarios]
        xs = np.arange(len(scenarios))
        ax.plot(xs, bh, "-o", color=OI["grey"], ms=3.5, lw=1.4,
                label="buy & hold")
        ax.plot(xs, cc, "-o", color=OI["blue"], ms=3.5, lw=1.4,
                label="covered call (0.30d, 30 DTE)")
        ax.axhline(0, color=OI["black"], lw=0.6)
        ax.set_title(u, fontsize=9)
        ax.set_xticks(xs, scenarios, fontsize=8)
    axes[0, 0].legend(fontsize=7.5, loc="upper left")
    for ax in axes[:, 0]:
        ax.set_ylabel("1-yr total return, %")
    fig.suptitle("Covered call vs buy-and-hold by market scenario "
                 "(mean of Monte Carlo paths)", fontsize=10, y=0.99)
    fig.tight_layout()
    fig.savefig(out)
    plt.close(fig)


def chart_drawdown(results: dict, out: Path) -> None:
    """Median max drawdown, covered call vs buy-hold (base scenario)."""
    fig, ax = plt.subplots(figsize=(7, 3.4))
    x = np.arange(len(UNDERLYING_ORDER))
    width = 0.36
    cc = [-results["grid"][u]["base"]["d30_dte30"]["max_drawdown_median"] * 100
          for u in UNDERLYING_ORDER]
    bh = [-results["grid"][u]["base"]["d30_dte30"]["bh_max_drawdown_median"] * 100
          for u in UNDERLYING_ORDER]
    ax.bar(x - width / 2, bh, width, color=OI["grey"], label="buy & hold")
    ax.bar(x + width / 2, cc, width, color=OI["green"],
           label="covered call (0.30d, 30 DTE)")
    ax.set_xticks(x, UNDERLYING_ORDER)
    ax.set_ylabel("Median max drawdown, %")
    ax.set_title("Drawdown comparison, base scenario (+8%/yr drift)",
                 fontsize=10)
    ax.legend()
    fig.tight_layout()
    fig.savefig(out)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Markdown verdict
# ---------------------------------------------------------------------------


def _fmt_pct(x: float, signed: bool = False) -> str:
    return f"{x * 100:+.1f}%" if signed else f"{x * 100:.1f}%"


def write_markdown(results: dict, out: Path) -> None:
    g = results["grid"]
    lines = [
        "# Overwrite covered-call yield validation",
        "",
        f"Monte Carlo, {results['meta']['n_paths']} paths x 1yr per cell, "
        "GBM + Merton jumps calibrated to July 2026 IV30 anchors "
        "(SPY 16.5%, AAPL 22%, NVDA 44.5%, TSLA 45%, BTC 37.5%, ETH 50%); "
        "entry premiums reproduce the observed 30-delta 30-DTE anchors "
        "(SPY 0.88%, AAPL 1.16%, NVDA 2.27% of spot) to within 1%. "
        "Edge source is an explicit implied-minus-realized vol spread (VRP): "
        "SPY 3.0 pts, AAPL 4.0, NVDA/TSLA 7.0, BTC 5.0, ETH 7.0. "
        "Strategy: sell 1 covered call per unit, cash-settled European "
        "(Derive-style), roll at 21 DTE, take-profit at 75% premium decay, "
        "credit-only defensive roll at 0.60 delta, maker fee 3bps of premium "
        "+ $0.10/contract.",
        "",
        "## Verdict: is ~10% annualized premium yield realistic?",
        "",
        "| Underlying | Quoted premium (0.30d/30DTE, ann.) | Net premium kept"
        " (base) | Clears 10% gross? | Net vs B&H: bear / flat / base / bull /"
        " moon | Months hitting 10%/12 target |",
        "|---|---|---|---|---|---|",
    ]
    scenarios = ["bear", "flat", "base", "bull", "moon"]
    for u in UNDERLYING_ORDER:
        base = g[u]["base"]["d30_dte30"]
        quoted = base["quoted_premium_annualized"]
        kept = base["net_premium_captured"]
        gaps = " / ".join(
            _fmt_pct(g[u][sc]["d30_dte30"]["outperformance_mean"], signed=True)
            for sc in scenarios
        )
        clears = ("**yes**" if quoted >= CLAIM * 1.15
                  else ("marginal" if quoted >= CLAIM * 0.85 else "**no**"))
        lines.append(
            f"| {u} | {_fmt_pct(quoted)} | {_fmt_pct(kept, signed=True)} | "
            f"{clears} | {gaps} | {_fmt_pct(base['pct_months_premium_target_hit'])} |"
        )

    # Findings
    spy_base = g["SPY"]["base"]["d30_dte30"]
    spy_bull = g["SPY"]["bull"]["d30_dte30"]
    eth_base = g["ETH"]["base"]["d30_dte30"]
    nvda_base = g["NVDA"]["base"]["d30_dte30"]
    lines += [
        "",
        "*Quoted premium = average premium at sale x hold-to-expiry cadence "
        "(the number a marketing page would quote). Net premium kept = "
        "premiums minus buybacks, settlements and fees — what actually lands "
        "in the account after the option leg is settled up.*",
        "",
        "## Findings",
        "",
        f"- **The '~10% yield' is a gross-premium statement, and only "
        f"high-IV names clear it comfortably.** At 0.30 delta / 30 DTE the "
        f"annualized quoted premium is ~"
        f"{_fmt_pct(spy_base['quoted_premium_annualized'])} on SPY (right at "
        f"the claim), ~{_fmt_pct(g['AAPL']['base']['d30_dte30']['quoted_premium_annualized'])} "
        f"on AAPL, and "
        f"{_fmt_pct(g['BTC']['base']['d30_dte30']['quoted_premium_annualized'])}–"
        f"{_fmt_pct(g['ETH']['base']['d30_dte30']['quoted_premium_annualized'])} "
        f"on NVDA/TSLA/BTC/ETH. At 0.15 delta — the 'rarely called away' "
        f"setting — SPY quotes only "
        f"{_fmt_pct(g['SPY']['base']['d15_dte30']['quoted_premium_annualized'])} "
        f"and the claim is out of reach on anything but the high-IV names. "
        f"But quoted premium is not return: net premium "
        f"actually kept in the base scenario is "
        f"{_fmt_pct(spy_base['net_premium_captured'], signed=True)} (SPY) to "
        f"{_fmt_pct(eth_base['net_premium_captured'], signed=True)} (ETH) "
        f"because winners get bought back and ITM calls are paid off.",
        f"- **What it costs: upside.** In the bull scenario (+25%/yr) the "
        f"0.30-delta program lags buy-and-hold by "
        f"{_fmt_pct(-spy_bull['outperformance_mean'])} on SPY and "
        f"{_fmt_pct(-g['NVDA']['bull']['d30_dte30']['outperformance_mean'])} "
        f"on NVDA; in the moon scenario (+60%) the lag reaches "
        f"{_fmt_pct(-g['AAPL']['moon']['d30_dte30']['outperformance_mean'])} "
        f"(AAPL) and "
        f"{_fmt_pct(-g['ETH']['moon']['d30_dte30']['outperformance_mean'])} "
        f"(ETH). This matches the BXMD record (lags ~5pts in strong bull "
        f"years) — the strategy sells exactly the outcomes crypto/tech "
        f"holders buy these assets for. The one exception: ETH still edges "
        f"out buy-and-hold in the +25% case "
        f"({_fmt_pct(g['ETH']['bull']['d30_dte30']['outperformance_mean'], signed=True)}) "
        f"because a +25% year is only ~0.5 sigma for a 50-vol asset and the "
        f"assumed 7-pt crypto VRP is large — that result stands or falls "
        f"with the VRP persisting.",
        f"- **Where it wins: flat-to-down markets and risk metrics.** "
        f"Volatility drops roughly a third (SPY "
        f"{_fmt_pct(spy_base['ann_vol_median'])} vs "
        f"{_fmt_pct(spy_base['bh_ann_vol_median'])}; ETH "
        f"{_fmt_pct(eth_base['ann_vol_median'])} vs "
        f"{_fmt_pct(eth_base['bh_ann_vol_median'])}), median max drawdown "
        f"improves in every cell, and in bear/flat scenarios the program "
        f"beats holding by "
        f"{_fmt_pct(g['ETH']['bear']['d30_dte30']['outperformance_mean'], signed=True)} "
        f"(ETH bear) and "
        f"{_fmt_pct(g['ETH']['flat']['d30_dte30']['outperformance_mean'], signed=True)} "
        f"(ETH flat).",
        f"- **The monthly cadence is lumpy.** Even where the annualized "
        f"quoted premium clears 10%, only "
        f"{_fmt_pct(spy_base['pct_months_premium_target_hit'])} (SPY) to "
        f"{_fmt_pct(eth_base['pct_months_premium_target_hit'])} (ETH) of "
        f"months actually net >= 10%/12 of spot after buybacks — a chunk of "
        f"collected premium is routinely handed back rolling calls that went "
        f"ITM. Marketing a smooth '10% APY' would misrepresent the cashflow "
        f"profile.",
        f"- **Sanity vs listed-market history.** Simulated SPY 0.30-delta "
        f"nets {_fmt_pct(spy_base['net_total_return_mean'], signed=True)} vs "
        f"{_fmt_pct(spy_base['buyhold_return_mean'], signed=True)} buy-hold "
        f"in the +8% base case and lags ~"
        f"{_fmt_pct(-spy_bull['outperformance_mean'])} in the bull case — "
        f"consistent with BXMD vs S&P 500 (10.4% vs 10.9%/yr since 1986, "
        f"~5pt lag in strong bull years). QYLD-style NAV erosion shows up "
        f"only if premium is distributed rather than reinvested: the engine "
        f"reinvests, so flat/bear scenarios preserve capital.",
        "",
        "## Caveats (read before quoting these numbers)",
        "",
        "- Monte Carlo, not history: paths are GBM+jumps under assumed drift "
        "scenarios. The historical loader (`backtest.paths.load_historical`) "
        "requires network and runs on your machine, not in this sandbox.",
        "- No vol skew (flat smile per date) and no discrete strike/expiry "
        "grid; premiums are pinned to July-2026 anchors at entry instead.",
        "- The VRP parameters ARE the edge. Set VRP to 0 and net premium "
        "captured drops roughly by the VRP's vega value — if you believe "
        "option markets on these names are fairly priced, expect the covered "
        "call to strictly lose vs holding in up markets.",
        "- Derive-specific frictions (spread crossing on illiquid strikes, "
        "funding/collateral haircuts, oracle settlement) are modeled only as "
        "a 3bps + $0.10 fee; on thin books effective costs can be several "
        "times larger.",
    ]
    out.write_text("\n".join(lines))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--paths", type=int, default=2000)
    ap.add_argument("--days", type=int, default=365)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    RESULTS_DIR.mkdir(exist_ok=True)
    print(f"Running validation grid: {len(UNDERLYING_ORDER)} underlyings x "
          f"{len(DELTAS)} deltas x {len(DTES)} DTEs x "
          f"{len(DRIFT_SCENARIOS)} drifts x {args.paths} paths ...",
          flush=True)
    results = run_grid(n_paths=args.paths, n_days=args.days, seed=args.seed)

    (RESULTS_DIR / "validation.json").write_text(
        json.dumps(results, indent=1)
    )
    write_markdown(results, RESULTS_DIR / "validation.md")
    chart_premium_yield(results, RESULTS_DIR / "premium_yield_by_underlying.png")
    chart_return_vs_buyhold(results, RESULTS_DIR / "total_return_vs_buyhold.png")
    chart_drawdown(results, RESULTS_DIR / "drawdown_comparison.png")
    print(f"Done in {results['meta']['runtime_seconds']}s. "
          f"Outputs in {RESULTS_DIR}")


if __name__ == "__main__":
    main()
