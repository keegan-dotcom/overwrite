import { Quote, asset, strategy } from "../../data/appdata";
import { fmtUsd, fmtPct } from "../../lib/options";
import { PayoffChart } from "./PayoffChart";

/**
 * The structured trade: what the intent engine built, disclosed in full.
 * No greeks required - but the real strikes/premiums are all here.
 */
export function TradeTicket({
  q, qty, onDeploy, deployed,
}: {
  q: Quote;
  qty: number;
  onDeploy: () => void;
  deployed: boolean;
}) {
  const a = asset(q.assetSymbol);
  const s = strategy(q.strategyId);
  const income = q.incomeMonthly * qty;

  return (
    <div className="border-2 border-mint bg-pane shadow-hard">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-line px-4 py-3">
        <div>
          <div className="font-display text-xl uppercase tracking-wide text-paper">
            {s.emoji} {q.title}
          </div>
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-fog">
            {s.proName} · {q.dte}d · sized to {qty.toLocaleString()} {a.symbol}
            {!a.live && " · preview - awaiting Derive listing"}
          </div>
        </div>
        <div className="text-right">
          {q.incomeAnnualPct > 0 ? (
            <>
              <div className="font-display text-2xl text-mint">{fmtPct(q.incomeAnnualPct, 1)}/yr</div>
              <div className="font-mono text-[11px] uppercase text-fog">≈ {fmtUsd(income, 0)} per cycle</div>
            </>
          ) : (
            <div className="font-mono text-[12px] uppercase text-amber">
              costs {fmtUsd(Math.abs(income), 0)} / cycle
            </div>
          )}
        </div>
      </div>

      <p className="border-b-2 border-line px-4 py-3 font-serif text-[15px] leading-snug text-paper">
        {q.headline}
      </p>

      <div className="border-b-2 border-line px-2 py-2">
        <PayoffChart q={q} />
      </div>

      {/* legs */}
      <div className="border-b-2 border-line px-4 py-3">
        <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-fog">
          Structured as
        </div>
        <div className="space-y-1 font-mono text-[12.5px] text-paper">
          {q.assetQty > 0 && (
            <div className="flex justify-between">
              <span>HOLD {qty.toLocaleString()} {a.symbol}</span>
              <span className="text-fog">{fmtUsd(a.spot * qty)}</span>
            </div>
          )}
          {q.legs.map((l, i) => (
            <div key={i} className="flex justify-between">
              <span className={l.side === "short" ? "text-amber" : "text-mint"}>
                {l.side === "short" ? "SELL" : "BUY"} {q.assetSymbol} {fmtUsd(l.strike)} {l.kind.toUpperCase()} ×{(l.qty * qty).toLocaleString()}
              </span>
              <span className="text-fog">
                {l.side === "short" ? "+" : "-"}{fmtUsd(l.premium * qty, 0)} premium
              </span>
            </div>
          ))}
          {q.hedgeNote && (
            <div className="flex justify-between text-mint">
              <span>{q.hedgeNote}</span>
              <span className="text-fog">delta ≈ 0</span>
            </div>
          )}
          {q.stopLossPct != null && (
            <div className="flex justify-between text-rose">
              <span>AUTO-CLOSE</span>
              <span>if position -{fmtPct(q.stopLossPct, 0)}</span>
            </div>
          )}
        </div>
      </div>

      {/* full disclosure */}
      <div className="grid gap-0 border-b-2 border-line sm:grid-cols-2">
        <div className="border-line px-4 py-3 sm:border-r-2">
          <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-amber">
            Know before you deploy
          </div>
          <ul className="space-y-1.5 font-serif text-[13px] leading-snug text-paper/90">
            {q.tradeoffs.map((x, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-amber">→</span><span>{x}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="px-4 py-3">
          <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-mint">
            The agent handles
          </div>
          <ul className="space-y-1.5 font-serif text-[13px] leading-snug text-paper/90">
            {q.managed.map((x, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-mint">✓</span><span>{x}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fog">
          Executes from YOUR isolated vault · funds never pooled
        </div>
        <button
          onClick={onDeploy}
          disabled={deployed || !a.live}
          className={`border-2 px-5 py-2 font-mono text-[13px] font-bold uppercase tracking-[0.08em] transition-transform ${
            deployed
              ? "border-line text-fog"
              : a.live
              ? "border-paper bg-accent text-ink shadow-hardsm hover:-translate-x-px hover:-translate-y-px"
              : "border-line text-fog"
          }`}
        >
          {deployed ? "✓ Deployed" : a.live ? "Approve & deploy" : "Awaiting listing"}
        </button>
      </div>
    </div>
  );
}
