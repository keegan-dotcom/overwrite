import { Holding, STRATEGIES, Strategy, asset } from "../../data/appdata";
import { fmtPct, fmtUsd } from "../../lib/options";

const RISK_DOT: Record<Strategy["risk"], string> = {
  conservative: "bg-mint", moderate: "bg-amber", spicy: "bg-rose",
};

/**
 * Left rail, exchange-style: vertical strategy list quoted live for the
 * selected asset, portfolio underneath. Compact by design - detail lives
 * in the ticket.
 */
export function StrategyRail({
  symbol, activeId, onPick, holdings, usdc, walletLabel, onSelectAsset, selected,
}: {
  symbol: string;
  activeId: string | null;
  onPick: (id: string) => void;
  holdings: Holding[];
  usdc: number;
  walletLabel: string | null;
  onSelectAsset: (sym: string) => void;
  selected: string;
}) {
  const a = asset(symbol);
  const total = holdings.reduce((s, h) => s + h.qty * asset(h.symbol).spot, 0) + usdc;

  return (
    <div className="flex h-full min-h-0 flex-col border-2 border-line bg-pane">
      <div className="border-b-2 border-line px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fog">
        Strategies · {symbol}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {STRATEGIES.map((s) => {
          const q = s.quote(a);
          const picked = activeId === s.id;
          const stat = q.incomeAnnualPct > 0
            ? `~${fmtPct(q.incomeAnnualPct, 1)}/yr`
            : q.floorPrice != null ? `floor ${fmtUsd(q.floorPrice)}` : "capped risk";
          return (
            <button key={s.id} onClick={() => onPick(s.id)}
              className={`flex w-full items-center gap-2.5 border-b border-line px-3 py-2.5 text-left transition-colors ${
                picked ? "bg-ink shadow-[inset_2px_0_0_0_#3DFFA8]" : "hover:bg-ink/60"
              }`}>
              <span className="text-[15px] leading-none">{s.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate font-mono text-[11.5px] font-bold uppercase tracking-[0.04em] ${picked ? "text-mint" : "text-paper"}`}>
                  {s.name}
                </span>
                <span className="block truncate font-mono text-[10px] text-fog">{stat}</span>
              </span>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${RISK_DOT[s.risk]}`} title={s.risk} />
            </button>
          );
        })}
      </div>

      <div className="border-t-2 border-line px-3 py-2">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fog">Vault</span>
          <span className="font-mono text-[9.5px] uppercase text-mint">
            {walletLabel ? `${walletLabel} · live` : "demo"}
          </span>
        </div>
        <div className="font-display text-lg leading-tight text-paper">{fmtUsd(total)}</div>
      </div>
      <div className="max-h-40 overflow-y-auto border-t border-line">
        {holdings.map((h) => {
          const ha = asset(h.symbol);
          const empty = h.qty <= 0;
          return (
            <button key={h.symbol} onClick={() => onSelectAsset(h.symbol)}
              className={`flex w-full items-center justify-between px-3 py-1.5 font-mono text-[11px] transition-colors ${
                selected === h.symbol ? "bg-ink text-mint" : empty ? "text-fog/70 hover:bg-ink/60" : "text-paper hover:bg-ink/60"
              }`}>
              <span>{h.symbol} <span className="text-fog">{empty ? "0" : h.qty.toLocaleString()}</span></span>
              <span className="text-fog">{empty ? "—" : fmtUsd(h.qty * ha.spot)}</span>
            </button>
          );
        })}
        {usdc > 0 && (
          <div className="flex items-center justify-between px-3 py-1.5 font-mono text-[11px] text-paper">
            <span>USDC <span className="text-fog">cash</span></span>
            <span className="text-fog">{fmtUsd(usdc)}</span>
          </div>
        )}
      </div>
      <div className="border-t border-line px-3 py-1.5 font-serif text-[10.5px] italic leading-snug text-fog">
        One isolated vault per user — only your keys withdraw.
      </div>
    </div>
  );
}
