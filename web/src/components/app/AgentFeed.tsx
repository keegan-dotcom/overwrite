import type { FeedEvent, Position, Suggestion } from "./types";
import { asset } from "../../data/appdata";
import { fmtUsd, fmtPct } from "../../lib/options";

const KIND_STYLE: Record<FeedEvent["kind"], string> = {
  info: "text-fog",
  action: "text-mint",
  suggest: "text-amber",
};

/**
 * The active-management loop: open positions + the agent's live commentary
 * + suggestion cards the user can accept or dismiss. The point: strategies
 * aren't fire-and-forget - and changing your mind is one click or one prompt.
 */
export function AgentFeed({
  positions, feed, suggestion, onAccept, onDismiss,
}: {
  positions: Position[];
  feed: FeedEvent[];
  suggestion: Suggestion | null;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="border-2 border-line bg-pane">
      <div className="flex items-center justify-end border-b border-line px-4 py-1.5">
        <div className="flex items-center gap-1.5 font-mono text-[13px] uppercase text-mint">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-mint" />
          watching
        </div>
      </div>

      {/* open positions */}
      <div className="border-b-2 border-line px-4 py-2.5">
        <div className="mb-1 font-mono text-[12.5px] uppercase tracking-[0.14em] text-fog">
          Open positions ({positions.length})
        </div>
        {positions.length === 0 ? (
          <div className="font-serif text-[14.5px] italic text-fog">
            Nothing deployed yet - pick a strategy or ask for one.
          </div>
        ) : (
          <div className="space-y-1">
            {positions.map((p) => {
              const a = asset(p.assetSymbol);
              const leg = p.quote.legs[0];
              return (
                <div key={p.id} className="flex items-center justify-between font-mono text-[14px]">
                  <span className="text-paper">
                    {p.quote.title.replace(" · ", " ")}
                    <span className="ml-2 text-fog">
                      {leg ? `${fmtUsd(leg.strike)} ${leg.kind}` : ""} · {p.qty.toLocaleString()} {a.symbol}
                    </span>
                  </span>
                  <span className="text-mint">
                    {p.quote.incomeAnnualPct > 0 ? `${fmtPct(p.quote.incomeAnnualPct, 1)}/yr` : "hedged"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* suggestion card */}
      {suggestion && (
        <div className="border-b-2 border-amber bg-ink px-4 py-3">
          <div className="font-mono text-[12.5px] uppercase tracking-[0.14em] text-amber">
            Agent suggestion · market moved
          </div>
          <div className="mt-1 font-serif text-[15px] font-bold leading-snug text-paper">
            {suggestion.title}
          </div>
          <div className="mt-0.5 font-serif text-[14.5px] leading-snug text-paper/95">
            {suggestion.detail}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={onAccept}
              className="border-2 border-paper bg-accent px-3 py-1 font-mono text-[13px] font-bold uppercase text-ink shadow-hardsm transition-transform hover:-translate-x-px hover:-translate-y-px"
            >
              Accept
            </button>
            <button
              onClick={onDismiss}
              className="border-2 border-line px-3 py-1 font-mono text-[13px] uppercase text-fog transition-colors hover:border-fog"
            >
              Keep as is
            </button>
          </div>
        </div>
      )}

      {/* feed */}
      <div className="max-h-56 space-y-1.5 overflow-y-auto px-4 py-2.5 font-mono text-[13.5px] leading-snug">
        {feed.length === 0 && (
          <div className="font-serif text-[14.5px] italic text-fog">
            The loop starts when you deploy: monitoring, take-profits, rolls,
            and suggestions land here.
          </div>
        )}
        {feed.map((e, i) => (
          <div key={i} className="flex gap-2">
            <span className="shrink-0 text-fog/85">{e.ts}</span>
            <span className={KIND_STYLE[e.kind]}>{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
