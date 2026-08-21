import { UNDERLYINGS, pct } from "../data/validation";

/** Ticker tape: ink strip, mono figures, like a broadsheet market band. */
export function Ticker() {
  const items = UNDERLYINGS.map((u) => ({
    label: u.symbol,
    value: `${pct(u.gross.d25, 0)} gross/yr @ 0.25Δ`,
    live: u.live,
  }));
  const row = [...items, ...items];
  return (
    <div className="overflow-hidden border-b-2 border-paper bg-pane py-2.5">
      <div className="marquee-track flex w-max items-center gap-10 px-5">
        {row.map((it, i) => (
          <span key={i} className="flex items-center gap-2.5 font-mono text-[14.5px] text-dfog">
            <span className={`inline-block h-2 w-2 ${it.live ? "bg-mint live-dot" : "bg-amber"}`} />
            <span className="font-bold text-paper">{it.label}</span>
            {it.value}
            {!it.live && <span className="text-amber">· awaiting listing</span>}
            <span className="text-line">///</span>
          </span>
        ))}
      </div>
    </div>
  );
}
