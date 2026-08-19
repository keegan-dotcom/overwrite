import { DEMO_PORTFOLIO, Holding, asset } from "../../data/appdata";
import { fmtUsd } from "../../lib/options";
import type { Position } from "./types";

export function VaultPanel({
  selected, onSelect, positions, vaultNote, holdings = DEMO_PORTFOLIO, usdc = 0, walletLabel = null,
}: {
  selected: string;
  onSelect: (sym: string) => void;
  positions: Position[];
  vaultNote?: string;
  holdings?: Holding[];
  usdc?: number;
  walletLabel?: string | null;
}) {
  const total = holdings.reduce((s, h) => s + h.qty * asset(h.symbol).spot, 0) + usdc;

  return (
    <div className="border-2 border-line bg-pane">
      <div className="border-b-2 border-line px-4 py-3">
        <div className="flex items-baseline justify-between">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-fog">Your vault</div>
          {walletLabel ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-mint">
              {walletLabel} · live
            </span>
          ) : (
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-fog">demo portfolio</span>
          )}
        </div>
        <div className="font-display text-2xl text-paper">{fmtUsd(total)}</div>
        <div className="mt-1 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-mint">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-mint" />
          isolated · only your keys withdraw
        </div>
      </div>

      <div className="divide-y divide-line">
        {holdings.map((h) => {
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
        {usdc > 0 && (
          <div className="flex w-full items-center justify-between px-4 py-2.5">
            <div>
              <div className="font-mono text-[13px] font-bold text-paper">USDC</div>
              <div className="font-mono text-[11px] text-fog">cash · collateral for The Wheel</div>
            </div>
            <div className="font-mono text-[13px] text-paper">{fmtUsd(usdc)}</div>
          </div>
        )}
      </div>

      <div className="border-t-2 border-line px-4 py-2.5 font-serif text-[12px] leading-snug text-fog">
        {vaultNote ?? "One vault per user. No pooled funds, no shared honeypot - a hack of someone else's vault can't touch yours."}
      </div>
    </div>
  );
}
