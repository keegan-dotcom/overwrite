import { Reveal } from "./Reveal";
import { SectionHead } from "./SectionHead";
import { UNDERLYINGS, pct } from "../data/validation";

export function Vaults() {
  return (
    <section id="vaults" className="mx-auto max-w-6xl px-5 py-24">
      <SectionHead
        no="03"
        kicker="The book"
        title={<>Two markets live. Four waiting on <span className="text-accent">listing day.</span></>}
      >
        Derive already runs the deepest options book on-chain — its first
        real-world-asset market (tokenized gold) shipped in July. When
        tokenized-stock options list, these flip on with one config line.
      </SectionHead>

      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {UNDERLYINGS.map((u, i) => (
          <Reveal key={u.symbol} delay={(i % 3) as 0 | 1 | 2}>
            <VaultCard u={u} idx={i} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function VaultCard({ u, idx }: { u: (typeof UNDERLYINGS)[number]; idx: number }) {
  return (
    <div className={`ticket ticket-accent p-0 ${idx % 2 ? "rotate-[0.6deg]" : "-rotate-[0.6deg]"} hover:rotate-0`}>
      {/* ticket header strip */}
      <div className={`flex items-center justify-between border-b-2 border-paper px-5 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em] ${u.live ? "bg-mint text-ink" : "bg-amber/20 text-paper"}`}>
        <span>{u.live ? "● Testnet live" : "○ Awaiting listing"}</span>
        <span>№ {String(idx + 1).padStart(3, "0")}</span>
      </div>
      <div className="p-5">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-4xl uppercase">{u.symbol}</span>
          <span className="font-mono text-sm text-fog">{u.name}</span>
        </div>
        <div className="mt-5 flex items-end justify-between border-t border-line pt-4">
          <div>
            <p className="font-display text-5xl leading-none text-market">{pct(u.gross.d25, 0)}</p>
            <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-fog">
              gross premium/yr @ 0.25Δ
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-lg font-bold">{pct(u.iv, 0)}</p>
            <p className="mt-1 font-mono text-[11px] uppercase text-fog">IV30</p>
          </div>
        </div>
        <p className="mt-4 border-t-2 border-dashed border-fog/50 pt-3 font-mono text-[12px] leading-relaxed text-fog">
          {u.live
            ? "Selling 25–60 DTE calls on Derive testnet now. Mainnet: bring your own keys."
            : "Parameters pre-tuned from validation. Flips on the day Derive lists it."}
        </p>
      </div>
    </div>
  );
}
