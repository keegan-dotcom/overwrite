import { Reveal } from "./Reveal";

export function Honest() {
  return (
    <section id="honest" className="mx-auto max-w-6xl px-5 py-28">
      <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:items-center">
        <Reveal>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-amber">
            The part everyone else hides
          </p>
          <h2 className="mt-3 font-display text-4xl font-light tracking-tight sm:text-5xl">
            Premium yield is <em className="not-italic text-amber">not</em>{" "}
            total return.
          </h2>
          <div className="mt-6 space-y-4 text-fog leading-relaxed">
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
              instead of a slogan. If a covered-call product ever promises you
              smooth double-digit APY with no cost, it is lying about one of
              the two.
            </p>
          </div>
        </Reveal>
        <Reveal delay={1}>
          <div className="rounded-2xl border border-line bg-pane p-7">
            <p className="font-mono text-xs text-fog">WHAT A +25% YEAR COSTS (0.30Δ, vs buy-and-hold)</p>
            <div className="mt-5 space-y-3">
              {[
                { s: "ETH", v: 1.8, max: 6 },
                { s: "BTC", v: -0.5, max: 6 },
                { s: "TSLA", v: -1.5, max: 6 },
                { s: "NVDA", v: -2.9, max: 6 },
                { s: "SPY", v: -4.4, max: 6 },
                { s: "AAPL", v: -5.4, max: 6 },
              ].map((r) => (
                <div key={r.s} className="flex items-center gap-3">
                  <span className="w-12 font-mono text-sm text-paper">{r.s}</span>
                  <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-line">
                    <div
                      className={`absolute top-0 h-full rounded-full ${r.v >= 0 ? "bg-mint" : "bg-amber"}`}
                      style={{
                        left: r.v >= 0 ? "50%" : `${50 - (Math.abs(r.v) / r.max) * 50}%`,
                        width: `${(Math.abs(r.v) / r.max) * 50}%`,
                      }}
                    />
                    <div className="absolute left-1/2 top-0 h-full w-px bg-fog/40" />
                  </div>
                  <span className={`w-16 text-right font-mono text-sm ${r.v >= 0 ? "text-mint" : "text-amber"}`}>
                    {r.v >= 0 ? "+" : ""}{r.v.toFixed(1)}pts
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-5 font-mono text-[11px] leading-relaxed text-fog">
              Monte-Carlo, 2,000 paths/cell, VRP calibrated to BXM/BXMD.
              Crypto's fatter vol premium is why ETH still wins here — and why
              that edge must be re-checked, not assumed.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
