import { DEMO_PORTFOLIO, asset } from "../../data/appdata";
import { fmtUsd } from "../../lib/options";
import type { Position } from "./types";

export function VaultPanel({
  selected, onSelect, positions, vaultNote,
}: {
  selected: string;
  onSelect: (sym: string) => void;
  positions: Position[];
  vaultNote?: string;
}) {
  const total = DEMO_PORTFOLIO.reduce((s, h) => s + h.qty * asset(h.symbol).spot, 0);

  return (
    <div className="border-2 border-line bg-pane">
      <div className="border-b-2 border-line px-4 py-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-fog">Your vault</div>
        <div className="font-display text-2xl text-paper">{fmtUsd(total)}</div>
        <div className="mt-1 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-mint">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-mint" />
          isolated · 0x7f3…c21 · only your keys withdraw
        </div>
      </div>

      <div className="divide-y divide-line">
        {DEMO_PORTFOLIO.map((h) => {
          const a = asset(h.symbol);
          const active = positions.filter((p) => p.assetSymbol === h.symbol).length;
          return (
            <button
              key={h.symbol}
              onClick={() => onSelect(h.symbol)}
              className={`flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors ${
                selected === h.symbol ? "bg-ink" : "hover:bg-ink/60"
              }`}
            >
              <div>
                <div className="font-mono text-[13px] font-bold text-paper">
                  {h.symbol}
                  {!a.live && <span className="ml-2 text-[10px] font-normal uppercase text-amber">soon</span>}
                  {active > 0 && (
                    <span className="ml-2 border border-mint px-1 text-[10px] font-normal uppercase text-mint">
                      {active} active
                    </span>
                  )}
                </div>
                <div className="font-mono text-[11px] text-fog">
                  {h.qty.toLocaleString()} · {fmtUsd(a.spot)}
                </div>
              </div>
              <div className="font-mono text-[13px] text-paper">{fmtUsd(h.qty * a.spot)}</div>
            </button>
          );
        })}
      </div>

      <div className="border-t-2 border-line px-4 py-2.5 font-serif text-[12px] leading-snug text-fog">
        {vaultNote ?? "One vault per user. No pooled funds, no shared honeypot - a hack of someone else's vault can't touch yours."}
      </div>
    </div>
  );
}
