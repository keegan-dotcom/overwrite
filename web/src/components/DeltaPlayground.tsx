import { useState } from "react";
import { Reveal } from "./Reveal";
import { DELTAS, UNDERLYINGS, pct, pts } from "../data/validation";

/**
 * The interactive centerpiece: pick an asset and a delta, see the real
 * validated numbers - gross premium AND what it costs in upside.
 * Every number ships from backtest/results/validation.json.
 */
export function DeltaPlayground() {
  const [sym, setSym] = useState("ETH");
  const [deltaIdx, setDeltaIdx] = useState(1);
  const u = UNDERLYINGS.find((x) => x.symbol === sym)!;
  const d = DELTAS[deltaIdx];
  const gross = u.gross[d.key];
  const monthly = gross / 12;

  return (
    <section id="yield" className="relative mx-auto max-w-6xl px-5 py-28">
      <Reveal>
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-mint">The dial</p>
        <h2 className="mt-3 max-w-2xl font-display text-4xl font-light tracking-tight sm:text-5xl">
          Pick your delta. See the <em className="not-italic text-mint">whole</em> trade.
        </h2>
        <p className="mt-4 max-w-xl text-fog">
          Most yield products show you the big number. Overwrite shows you both
          sides: the premium you collect and the upside you sell to get it.
          Every figure below comes from our published Monte-Carlo validation,
          calibrated to live IVs and 40 years of CBOE buy-write history.
        </p>
      </Reveal>

      <Reveal delay={1}>
        <div className="mt-12 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          {/* controls */}
          <div className="rounded-2xl border border-line bg-pane p-6">
            <p className="font-mono text-xs text-fog">ASSET</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {UNDERLYINGS.map((x) => (
                <button
                  key={x.symbol}
                  onClick={() => setSym(x.symbol)}
                  className={`rounded-full border px-4 py-1.5 font-mono text-sm transition-colors ${
                    sym === x.symbol
                      ? "border-mint bg-mint/10 text-mint"
                      : "border-line text-fog hover:border-fog"
                  }`}
                >
                  {x.symbol}
                  {!x.live && <span className="ml-1.5 text-[10px] text-amber">soon</span>}
                </button>
              ))}
            </div>

            <p className="mt-7 font-mono text-xs text-fog">CALL DELTA — HOW CLOSE TO THE MONEY YOU SELL</p>
            <input
              type="range"
              min={0}
              max={2}
              step={1}
              value={deltaIdx}
              onChange={(e) => setDeltaIdx(parseInt(e.target.value))}
              className="mt-4 w-full accent-mint"
              aria-label="Delta selector"
            />
            <div className="mt-1 flex justify-between font-mono text-xs text-fog">
              {DELTAS.map((dd, i) => (
                <button key={dd.key} onClick={() => setDeltaIdx(i)}
                  className={i === deltaIdx ? "text-mint" : ""}>
                  {dd.label}
                </button>
              ))}
            </div>
            <p className="mt-5 text-sm text-fog">
              <span className="text-paper">{d.tag}.</span> {d.capOdds}. Higher
              delta, fatter premium, more upside sold. There is no setting where
              you get both.
            </p>
          </div>

          {/* readout */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Stat
              big={pct(gross, 1)}
              label="gross premium / year"
              accent="mint"
              foot={`≈ ${pct(monthly, 2)} per monthly cycle`}
            />
            <Stat
              big={pct(u.iv, 0)}
              label="implied vol (IV30) priced in"
              accent="paper"
              foot={u.live ? "live on Derive" : "pre-tuned, awaits listing"}
            />
            <Stat
              big={pts(u.netEdgeBase)}
              label="net edge vs holding, base year*"
              accent={u.netEdgeBase >= 0 ? "mint" : "rose"}
              foot="*+8% drift scenario, 0.30Δ"
            />
            <Stat
              big={pts(u.bullCost)}
              label="vs holding in a +25% year"
              accent={u.bullCost >= 0 ? "mint" : "amber"}
              foot="what the premium costs in a rally"
            />
          </div>
        </div>
      </Reveal>

      <Reveal delay={2}>
        <p className="mt-6 font-mono text-xs leading-relaxed text-fog">
          Source: backtest/results/validation.json — 2,000 paths × 1yr per cell,
          Merton jumps, VRP calibrated so SPY reproduces the BXM/BXMD record.
          Premium yield ≠ total return. Downside is not hedged.
        </p>
      </Reveal>
    </section>
  );
}

function Stat({
  big, label, foot, accent,
}: { big: string; label: string; foot: string; accent: "mint" | "paper" | "rose" | "amber" }) {
  const color =
    accent === "mint" ? "text-mint" :
    accent === "rose" ? "text-rose" :
    accent === "amber" ? "text-amber" : "text-paper";
  return (
    <div className="tilt rounded-2xl border border-line bg-pane p-6 hover:border-mint/40 hover:shadow-[0_0_40px_-12px_rgba(61,255,168,0.25)]">
      <p className={`font-display text-4xl font-light tracking-tight ${color}`}>{big}</p>
      <p className="mt-2 text-sm text-paper">{label}</p>
      <p className="mt-1 font-mono text-xs text-fog">{foot}</p>
    </div>
  );
}
