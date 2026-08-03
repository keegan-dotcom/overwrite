import { STRATEGIES, Strategy, asset } from "../../data/appdata";
import { fmtPct, fmtUsd } from "../../lib/options";

const RISK_STYLE: Record<Strategy["risk"], string> = {
  conservative: "border-mint text-mint",
  moderate: "border-amber text-amber",
  spicy: "border-rose text-rose",
};
const RISK_LABEL: Record<Strategy["risk"], string> = {
  conservative: "low risk",
  moderate: "moderate",
  spicy: "spicy",
};

/**
 * The off-the-shelf strategies for the selected asset, quoted live.
 * Click one and the intent engine structures it into a ticket.
 */
export function StrategyShelf({
  symbol, activeId, onPick,
}: {
  symbol: string;
  activeId: string | null;
  onPick: (id: string) => void;
}) {
  const a = asset(symbol);
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {STRATEGIES.map((s) => {
        const q = s.quote(a);
        const picked = activeId === s.id;
        return (
          <button
            key={s.id}
            onClick={() => onPick(s.id)}
            className={`flex flex-col border-2 bg-pane p-3.5 text-left transition-all ${
              picked
                ? "border-mint shadow-hardsm"
                : "border-line hover:border-fog hover:-translate-y-px"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="font-display text-lg uppercase leading-tight text-paper">
                {s.emoji} {s.name}
              </div>
              <span className={`shrink-0 border px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.08em] ${RISK_STYLE[s.risk]}`}>
                {RISK_LABEL[s.risk]}
              </span>
            </div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fog">
              {s.proName}
            </div>
            <p className="mt-2 font-serif text-[13px] leading-snug text-paper/85">{s.tagline}</p>
            <div className="mt-auto pt-3">
              <div className="font-mono text-[13px] text-mint">
                {q.incomeAnnualPct > 0
                  ? `~${fmtPct(q.incomeAnnualPct, 1)}/yr income`
                  : q.floorPrice != null
                  ? `floor at ${fmtUsd(q.floorPrice)}`
                  : q.strategyId === "bear"
                  ? "risk strictly capped"
                  : ""}
              </div>
              <div className="mt-0.5 font-serif text-[11.5px] italic text-fog">
                Fits when: {s.fitsWhen}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
