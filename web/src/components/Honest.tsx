import { Reveal } from "./Reveal";


/** The "opinion page" - amber-accented, heavy-ruled, the disclosure section. */
export function Honest() {
  return (
    <section id="honest" className="border-y-2 border-paper bg-pane py-24">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal>
          <div className="rule-double pt-5">
            <div className="flex items-baseline gap-4 font-mono text-[12px] uppercase tracking-[0.2em] text-fog">
              <span className="font-bold text-amber">№ 04</span>
              <span>The part everyone else hides</span>
            </div>
            <h2 className="mt-4 max-w-3xl font-display text-4xl uppercase leading-[0.98] text-paper sm:text-6xl">
              Premium yield is <span className="text-amber">not</span> total return.
            </h2>
          </div>
        </Reveal>
        <div className="mt-12 grid gap-12 lg:grid-cols-2 lg:items-start">
          <Reveal>
            <div className="space-y-5 font-serif text-lg leading-relaxed text-paper/85">
              <p>
                Covered calls convert uncertain upside into certain income. In
                flat and falling markets you come out ahead; in a melt-up you
                give back several points versus just holding. Forty years of
                CBOE buy-write history says the long-run edge is real but modest
                — and the "111% yield" single-stock ETFs that hide this have
                delivered single-digit total returns.
              </p>
              <p>
                So Overwrite quotes both numbers, ships the simulation that
                produced them, and lets you choose the trade-off with a dial
                instead of a slogan. If a covered-call product ever promises
                smooth double-digit APY with no cost,{" "}
                <em className="not-italic font-semibold text-amber">
                  it is lying about one of the two.
                </em>
              </p>
            </div>
          </Reveal>
          <Reveal delay={1}>
            <div className="border-2 border-paper bg-ink p-6 shadow-hard">
              <p className="border-b-2 border-paper pb-2 font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-paper">
                What a +25% year costs (0.30Δ, vs buy-and-hold)
              </p>
              <div className="mt-5 space-y-3.5">
                {[
                  { s: "ETH", v: 1.8, max: 6 },
                  { s: "BTC", v: -0.5, max: 6 },
                  { s: "TSLA", v: -1.5, max: 6 },
                  { s: "NVDA", v: -2.9, max: 6 },
                  { s: "SPY", v: -4.4, max: 6 },
                  { s: "AAPL", v: -5.4, max: 6 },
                ].map((r) => (
                  <div key={r.s} className="flex items-center gap-3">
                    <span className="w-12 font-mono text-sm font-bold text-paper">{r.s}</span>
                    <div className="relative h-3 flex-1 border border-line bg-pane">
                      <div
                        className={`absolute top-0 h-full ${r.v >= 0 ? "bg-mint" : "bg-amber"}`}
                        style={{
                          left: r.v >= 0 ? "50%" : `${50 - (Math.abs(r.v) / r.max) * 50}%`,
                          width: `${(Math.abs(r.v) / r.max) * 50}%`,
                        }}
                      />
                      <div className="absolute left-1/2 top-0 h-full w-px bg-fog/50" />
                    </div>
                    <span className={`w-16 text-right font-mono text-sm ${r.v >= 0 ? "text-mint" : "text-amber"}`}>
                      {r.v >= 0 ? "+" : ""}{r.v.toFixed(1)}pts
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-5 border-t border-line pt-4 font-mono text-[11px] leading-relaxed text-fog">
                Monte-Carlo, 2,000 paths/cell, VRP calibrated to BXM/BXMD.
                Crypto's fatter vol premium is why ETH still wins here — and why
                that edge must be re-checked, not assumed.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
