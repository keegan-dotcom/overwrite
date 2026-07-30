import { UNDERLYINGS, pct } from "../data/validation";

/** Marquee of gross premium quotes; duplicated track for seamless loop. */
export function Ticker() {
  const items = UNDERLYINGS.map((u) => ({
    label: u.symbol,
    value: `${pct(u.gross.d25, 0)} gross/yr @ 0.25Δ`,
    live: u.live,
  }));
  const row = [...items, ...items];
  return (
    <div className="border-y border-line bg-pane/60 py-3 overflow-hidden">
      <div className="marquee-track flex w-max items-center gap-10 px-5">
        {row.map((it, i) => (
          <span key={i} className="flex items-center gap-2.5 font-mono text-sm text-fog">
            <span className={`h-1.5 w-1.5 rounded-full ${it.live ? "bg-mint live-dot" : "bg-amber"}`} />
            <span className="text-paper">{it.label}</span>
            {it.value}
            {!it.live && <span className="text-amber/80 text-xs">awaiting listing</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
