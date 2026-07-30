import { Reveal } from "./Reveal";
import { UNDERLYINGS, pct } from "../data/validation";

export function Vaults() {
  return (
    <section id="vaults" className="mx-auto max-w-6xl px-5 py-28">
      <Reveal>
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-mint">Vaults</p>
        <h2 className="mt-3 max-w-2xl font-display text-4xl font-light tracking-tight sm:text-5xl">
          Two markets live. Four waiting on{" "}
          <em className="not-italic text-mint">listing day.</em>
        </h2>
        <p className="mt-4 max-w-xl text-fog">
          Derive already runs the deepest options book on-chain — and its first
          real-world-asset market (tokenized gold) shipped in July. When
          tokenized-stock options list, these vaults flip on with one config
          line. Same engine, same rails.
        </p>
      </Reveal>

      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {UNDERLYINGS.map((u, i) => (
          <Reveal key={u.symbol} delay={(i % 3) as 0 | 1 | 2}>
            <VaultCard u={u} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function VaultCard({ u }: { u: (typeof UNDERLYINGS)[number] }) {
  return (
    <div
      className="tilt group relative overflow-hidden rounded-2xl border border-line bg-pane p-6 hover:border-mint/50 hover:shadow-[0_0_50px_-15px_rgba(61,255,168,0.3)]"
      onMouseMove={(e) => {
        const el = e.currentTarget;
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = `perspective(800px) rotateY(${x * 5}deg) rotateX(${-y * 5}deg)`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "";
      }}
    >
      <div className="flex items-center justify-between">
        <span className="font-display text-3xl font-light">{u.symbol}</span>
        {u.live ? (
          <span className="flex items-center gap-1.5 rounded-full border border-mint/40 bg-mint/10 px-3 py-1 font-mono text-[11px] text-mint">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-mint" /> TESTNET LIVE
          </span>
        ) : (
          <span className="rounded-full border border-amber/40 bg-amber/10 px-3 py-1 font-mono text-[11px] text-amber">
            AWAITING LISTING
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-fog">{u.name}</p>
      <div className="mt-6 flex items-end justify-between">
        <div>
          <p className="font-display text-4xl font-light text-mint">
            {pct(u.gross.d25, 0)}
          </p>
          <p className="mt-1 font-mono text-[11px] text-fog">
            gross premium/yr @ 0.25Δ
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm text-paper">{pct(u.iv, 0)}</p>
          <p className="mt-1 font-mono text-[11px] text-fog">IV30</p>
        </div>
      </div>
      <div className="mt-5 h-px w-full bg-line" />
      <p className="mt-4 font-mono text-[11px] leading-relaxed text-fog">
        {u.live
          ? "Selling 25–60 DTE calls on Derive testnet now. Mainnet: bring your own keys."
          : "Parameters pre-tuned from validation. Flips on the day Derive lists it."}
      </p>
    </div>
  );
}
