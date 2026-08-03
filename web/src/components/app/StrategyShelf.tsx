import { STRATEGIES, Strategy, asset } from "../../data/appdata";
import { fmtPct, fmtUsd } from "../../lib/options";

const RISK_STYLE: Record<Strategy["risk"], string> = {
  conservative: "text-mint",
  moderate: "text-amber",
  spicy: "text-rose",
};
const RISK_LABEL: Record<Strategy["risk"], string> = {
  conservative: "low risk",
  moderate: "moderate",
  spicy: "spicy",
};

/**
 * The strategy selector: one segmented control, five equal slots, quoted
 * live for the selected asset. Picking one structures it into the ticket
 * below - all detail lives there, not in scattered cards.
 */
export function StrategyShelf({
  symbol, activeId, onPick,
}: {
  symbol: string;
  activeId: string | null;
  onPick: (id: string) => void;
}) {
  const a = asset(symbol);
  const active = STRATEGIES.find((s) => s.id === activeId) ?? null;

  return (
    <div className="border-2 border-line bg-pane">
      <div className="grid grid-cols-2 sm:grid-cols-5">
        {STRATEGIES.map((s, i) => {
          const q = s.quote(a);
          const picked = activeId === s.id;
          const stat =
            q.incomeAnnualPct > 0
              ? `~${fmtPct(q.incomeAnnualPct, 1)}/yr`
              : q.floorPrice != null
              ? `floor ${fmtUsd(q.floorPrice)}`
              : "capped risk";
          return (
            <button
              key={s.id}
              onClick={() => onPick(s.id)}
              className={`flex flex-col items-center gap-1 border-b-2 border-line px-2 py-3 transition-colors sm:border-b-0 ${
                i < STRATEGIES.length - 1 ? "sm:border-r-2" : ""
              } ${i % 2 === 0 ? "border-r-2 sm:border-r-2" : ""} ${
                picked
                  ? "bg-ink shadow-[inset_0_-2px_0_0_#3DFFA8]"
                  : "hover:bg-ink/60"
              }`}
              aria-pressed={picked}
            >
              <span className="text-base leading-none">{s.emoji}</span>
              <span
                className={`font-mono text-[10.5px] font-bold uppercase tracking-[0.08em] ${
                  picked ? "text-mint" : "text-paper"
                }`}
              >
                {s.name}
              </span>
              <span className={`font-mono text-[10px] ${picked ? "text-mint/80" : "text-fog"}`}>
                {stat}
              </span>
            </button>
          );
        })}
      </div>
      {active && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t-2 border-line px-4 py-2">
          <div className="font-serif text-[13px] leading-snug text-paper/85">
            {active.tagline}{" "}
            <span className="italic text-fog">Fits when: {active.fitsWhen}</span>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-fog">
            {active.proName} · <span className={RISK_STYLE[active.risk]}>{RISK_LABEL[active.risk]}</span>
          </div>
        </div>
      )}
    </div>
  );
}
