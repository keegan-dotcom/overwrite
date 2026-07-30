import { useState } from "react";
import { Reveal } from "./Reveal";
import { SectionHead } from "./SectionHead";
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
    <section id="yield" className="mx-auto max-w-6xl px-5 py-24">
      <SectionHead
        no="01"
        kicker="The dial"
        title={<>Pick your delta. See the <span className="text-accent">whole</span> trade.</>}
      >
        Most yield products show you the big number. Overwrite shows both
        sides: the premium you collect and the upside you sell to get it.
        Every figure below comes from our published Monte-Carlo validation.
      </SectionHead>

      <Reveal delay={1}>
        <div className="mt-12 grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          {/* controls: a settings panel styled like a print order form */}
          <div className="ticket p-6">
            <p className="border-b-2 border-ink pb-2 font-mono text-[12px] font-bold uppercase tracking-[0.18em]">
              Field A — Asset
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {UNDERLYINGS.map((x) => (
                <button
                  key={x.symbol}
                  onClick={() => setSym(x.symbol)}
                  className={`border-2 px-4 py-1.5 font-mono text-sm font-bold transition-colors ${
                    sym === x.symbol
                      ? "border-ink bg-ink text-paper"
                      : "border-ink bg-paper text-ink hover:bg-cream"
                  }`}
                >
                  {x.symbol}
                  {!x.live && <span className="ml-1.5 text-[10px] text-amber">SOON</span>}
                </button>
              ))}
            </div>

            <p className="mt-8 border-b-2 border-ink pb-2 font-mono text-[12px] font-bold uppercase tracking-[0.18em]">
              Field B — Call delta
            </p>
            <input
              type="range"
              min={0}
              max={2}
              step={1}
              value={deltaIdx}
              onChange={(e) => setDeltaIdx(parseInt(e.target.value))}
              className="mt-5 w-full accent-accent"
              aria-label="Delta selector"
            />
            <div className="mt-1 flex justify-between font-mono text-sm">
              {DELTAS.map((dd, i) => (
                <button
                  key={dd.key}
                  onClick={() => setDeltaIdx(i)}
                  className={i === deltaIdx ? "font-bold text-accent" : "text-fog"}
                >
                  {dd.label}
                </button>
              ))}
            </div>
            <p className="mt-6 font-serif text-[15px] leading-relaxed text-ink/80">
              <span className="font-semibold">{d.tag}.</span> {d.capOdds}. Higher
              delta, fatter premium, more upside sold. There is no setting where
              you get both.
            </p>
          </div>

          {/* readout: stat tiles like newsprint figures */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Stat
              big={pct(gross, 1)}
              label="gross premium / year"
              tone="market"
              foot={`≈ ${pct(monthly, 2)} per monthly cycle`}
            />
            <Stat
              big={pct(u.iv, 0)}
              label="implied vol (IV30) priced in"
              tone="ink"
              foot={u.live ? "live on Derive" : "pre-tuned, awaits listing"}
            />
            <Stat
              big={pts(u.netEdgeBase)}
              label="net edge vs holding, base year*"
              tone={u.netEdgeBase >= 0 ? "market" : "rose"}
              foot="*+8% drift scenario, 0.30Δ"
            />
            <Stat
              big={pts(u.bullCost)}
              label="vs holding in a +25% year"
              tone={u.bullCost >= 0 ? "market" : "amber"}
              foot="what the premium costs in a rally"
            />
          </div>
        </div>
      </Reveal>

      <Reveal delay={2}>
        <p className="mt-8 border-l-4 border-accent pl-4 font-mono text-[12px] leading-relaxed text-fog">
          SOURCE: backtest/results/validation.json — 2,000 paths × 1yr per cell,
          Merton jumps, VRP calibrated so SPY reproduces the BXM/BXMD record.
          Premium yield ≠ total return. Downside is not hedged.
        </p>
      </Reveal>
    </section>
  );
}

function Stat({
  big, label, foot, tone,
}: { big: string; label: string; foot: string; tone: "market" | "ink" | "rose" | "amber" }) {
  const color =
    tone === "market" ? "text-market" :
    tone === "rose" ? "text-rose" :
    tone === "amber" ? "text-amber" : "text-ink";
  return (
    <div className="ticket p-6">
      <p className={`font-display text-5xl leading-none ${color}`}>{big}</p>
      <p className="mt-3 font-serif text-[15px] font-medium">{label}</p>
      <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.06em] text-fog">{foot}</p>
    </div>
  );
}
