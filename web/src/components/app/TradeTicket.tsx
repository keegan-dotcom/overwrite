import { ReactNode } from "react";
import { Quote, asset, strategy } from "../../data/appdata";
import { fmtUsd, fmtPct } from "../../lib/options";
import { PayoffChart } from "./PayoffChart";
import { VENUES, VenueMode } from "../../data/venues";

/**
 * The hero ticket: fills its column, CTA pinned to the bottom - never
 * below the fold. Disclosures scroll internally when long.
 */
export function TradeTicket({
  q, qty, onDeploy, deployed, venueMode = "v2", footerExtra,
}: {
  q: Quote;
  qty: number;
  onDeploy: () => void;
  deployed: boolean;
  venueMode?: VenueMode;
  footerExtra?: ReactNode;
}) {
  const a = asset(q.assetSymbol);
  const s = strategy(q.strategyId);
  const v = VENUES[venueMode];
  const income = q.incomeMonthly * qty;
  const managed = [...q.managed, ...v.extraManaged];

  return (
    <div className="flex h-full min-h-0 flex-col border-2 border-mint bg-pane shadow-hard">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 border-b-2 border-line px-4 py-2">
        <div className="min-w-0">
          <div className="truncate font-display text-lg uppercase tracking-wide text-paper">
            {s.emoji} {q.title}
          </div>
          <div className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-fog">
            {s.proName} · {q.dte}d · sized to {qty.toLocaleString()} {a.symbol}
            {!a.live && " · preview - awaiting listing"}
          </div>
        </div>
        <div className="text-right">
          {q.incomeAnnualPct > 0 ? (
            <>
              <div className="font-display text-xl leading-tight text-mint">{fmtPct(q.incomeAnnualPct, 1)}/yr</div>
              <div className="font-mono text-[10px] uppercase text-fog">≈ {fmtUsd(income, 0)}/cycle</div>
            </>
          ) : (
            <div className="font-mono text-[11px] uppercase text-amber">costs {fmtUsd(Math.abs(income), 0)}/cycle</div>
          )}
        </div>
      </div>

      <p className="border-b border-line px-4 py-1.5 font-serif text-[13px] leading-snug text-paper">
        {q.headline}
      </p>

      {/* chart - flexes, capped height */}
      <div className="mx-auto w-full max-w-[520px] shrink-0 px-2 pt-1">
        <PayoffChart q={q} />
      </div>

      {/* legs - compact */}
      <div className="shrink-0 border-y border-line px-4 py-1.5 font-mono text-[11.5px]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
          {q.assetQty > 0 && (
            <span className="text-paper">HOLD {qty.toLocaleString()} {a.symbol}</span>
          )}
          {q.legs.map((l, i) => (
            <span key={i} className={l.side === "short" ? "text-amber" : "text-mint"}>
              {l.side === "short" ? "SELL" : "BUY"} {fmtUsd(l.strike)} {l.kind.toUpperCase()} ×{(l.qty * qty).toLocaleString()}
              <span className="text-fog"> {l.side === "short" ? "+" : "-"}{fmtUsd(l.premium * qty, 0)}</span>
            </span>
          ))}
          {q.hedgeNote && <span className="text-mint">{q.hedgeNote}</span>}
          {q.stopLossPct != null && (
            <span className="text-rose">AUTO-CLOSE at -{fmtPct(q.stopLossPct, 0)}</span>
          )}
        </div>
      </div>

      {/* disclosures - the scrolling zone */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-y-auto sm:grid-cols-2">
        <div className="border-line px-4 py-2 sm:border-r">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-amber">
            Know before you deploy
          </div>
          <ul className="space-y-1 font-serif text-[12px] leading-snug text-paper/90">
            {q.tradeoffs.map((x, i) => (
              <li key={i} className="flex gap-1.5"><span className="text-amber">→</span><span>{x}</span></li>
            ))}
          </ul>
        </div>
        <div className="px-4 py-2">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-mint">
            The agent handles
          </div>
          <ul className="space-y-1 font-serif text-[12px] leading-snug text-paper/90">
            {managed.map((x, i) => (
              <li key={i} className="flex gap-1.5"><span className="text-mint">✓</span><span>{x}</span></li>
            ))}
          </ul>
        </div>
      </div>

      {/* pinned footer - CTA always visible */}
      <div className="shrink-0 border-t-2 border-line bg-pane px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 font-mono text-[9.5px] uppercase tracking-[0.1em] text-fog">
            your isolated vault · funds never pooled
            <span className="hidden truncate sm:block">{v.keyScope}</span>
          </div>
          {deployed && footerExtra ? footerExtra : (
            <button
              onClick={onDeploy}
              disabled={deployed || !a.live}
              className={`border-2 px-6 py-2 font-mono text-[13px] font-bold uppercase tracking-[0.08em] transition-transform ${
                deployed
                  ? "border-line text-fog"
                  : a.live
                  ? "border-paper bg-accent text-ink shadow-hardsm hover:-translate-x-px hover:-translate-y-px"
                  : "border-line text-fog"
              }`}
            >
              {deployed ? "✓ Deployed" : a.live ? "Approve & deploy" : "Awaiting listing"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
