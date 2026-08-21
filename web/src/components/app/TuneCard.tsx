import { useState, type ReactNode } from "react";
import type { StrategyPlan } from "../../lib/strategy/ir";
import { fmtUsd, fmtPct } from "../../lib/options";

/**
 * Review & tune — a compact, collapsed-by-default card the user sees AFTER the
 * chat suggests a structure and BEFORE it deploys. Smart defaults are already
 * filled, so the simple path is "glance → deploy". Expanding "Adjust" reveals
 * the knobs that matter — size, strike, expiry — plus hard guardrails (a max
 * the agent can EVER put on, a minimum premium floor) so a large account can
 * set the box once and the agent can never step outside it. Every edit mutates
 * the pending plan (the IR the executor runs); nothing here is cosmetic.
 */
export function TuneCard({ plan, onChange }: { plan: StrategyPlan; onChange: (p: StrategyPlan) => void }) {
  const [open, setOpen] = useState(false);
  const asset = plan.asset.toUpperCase();
  const spot = plan.spot?.[asset] ?? 0;
  const held = (plan.holdings ?? [])
    .filter((h) => h.asset.toUpperCase() === asset).reduce((a, h) => a + h.amount, 0);

  const sizeLeg = plan.legs.find((l) => l.sizing.kind === "pct_of_collateral" || l.sizing.kind === "cash_secured");
  const sizePct = sizeLeg?.sizing.kind === "pct_of_collateral" ? sizeLeg.sizing.pct
    : sizeLeg?.sizing.kind === "cash_secured" ? (sizeLeg.sizing.pct ?? 100) : null;
  const cashSecured = sizeLeg?.sizing.kind === "cash_secured";

  const optLeg = plan.legs.find((l) => l.venue === "option" && l.option);
  const delta = optLeg?.option?.strike.kind === "delta" ? optLeg.option.strike.target : null;
  const absStrike = optLeg?.option?.strike.kind === "absolute" ? optLeg.option.strike.price : null;
  const dteMid = optLeg?.option ? Math.round((optLeg.option.expiry.dteMin + optLeg.option.expiry.dteMax) / 2) : null;

  const maxNotional = plan.constraints.maxNotionalUsd ?? null;
  const minYield = plan.objective.targetYieldAnnual ?? null;

  // derived: what the current size actually commits
  const coverUnits = sizePct != null && !cashSecured ? held * (sizePct / 100) : null;
  const coverUsd = coverUnits != null ? coverUnits * spot : null;

  const clone = (): StrategyPlan => JSON.parse(JSON.stringify(plan));
  const setSize = (pct: number) => {
    const p = clone();
    for (const l of p.legs) {
      if (l.sizing.kind === "pct_of_collateral") l.sizing.pct = pct;
      else if (l.sizing.kind === "cash_secured") l.sizing.pct = pct;
    }
    onChange(p);
  };
  const setDelta = (t: number) => {
    const p = clone();
    for (const l of p.legs) if (l.option?.strike.kind === "delta") l.option.strike.target = t;
    onChange(p);
  };
  const setDte = (d: number) => {
    const p = clone();
    for (const l of p.legs) if (l.option) l.option.expiry = { dteMin: Math.max(2, d - 10), dteMax: d + 10 };
    onChange(p);
  };
  const setMaxNotional = (v: number | null) => {
    const p = clone();
    if (v && v > 0) p.constraints.maxNotionalUsd = v; else delete p.constraints.maxNotionalUsd;
    onChange(p);
  };
  const setMinYield = (pct: number | null) => {
    const p = clone();
    if (pct && pct > 0) p.objective.targetYieldAnnual = pct / 100; else delete p.objective.targetYieldAnnual;
    onChange(p);
  };

  const Row = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-24 shrink-0 font-mono text-[13px] uppercase tracking-[0.04em] text-fog">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  );

  return (
    <div className="border-2 border-line bg-ink">
      {/* header — always visible */}
      <button onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <span className="font-mono text-[13px] font-bold uppercase tracking-[0.08em] text-mint">Review &amp; tune</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[13.5px] text-paper">
          {sizePct != null && <>{sizePct}%{cashSecured ? " cash" : ` of ${asset}`} · </>}
          {delta != null ? `${delta.toFixed(2)}Δ` : absStrike != null ? fmtUsd(absStrike) : "—"}
          {dteMid != null && <> · ~{dteMid}d</>}
        </span>
        <span className="shrink-0 font-mono text-[13px] uppercase text-fog">{open ? "hide ▴" : "adjust ▾"}</span>
      </button>

      {open && (
        <div className="border-t border-line px-3 py-2">
          {sizePct != null && (
            <Row label="Size">
              <input type="range" min={10} max={100} step={5} value={sizePct}
                onChange={(e) => setSize(Number(e.target.value))} className="flex-1 accent-mint" />
              <span className="w-32 shrink-0 text-right font-mono text-[13px] text-paper">
                {sizePct}%{coverUsd != null && <span className="text-fog"> · {fmtUsd(coverUsd)}</span>}
              </span>
            </Row>
          )}

          {delta != null && (
            <Row label="Strike">
              <input type="range" min={0.10} max={0.45} step={0.05} value={delta}
                onChange={(e) => setDelta(Number(e.target.value))} className="flex-1 accent-mint" />
              <span className="w-32 shrink-0 text-right font-mono text-[13px] text-paper">
                {delta.toFixed(2)}Δ <span className="text-fog">{delta <= 0.2 ? "· safer" : delta >= 0.35 ? "· richer" : ""}</span>
              </span>
            </Row>
          )}
          {absStrike != null && (
            <Row label="Strike">
              <span className="font-mono text-[13px] text-paper">{fmtUsd(absStrike)}</span>
              <span className="font-mono text-[13px] text-fog">— set the level in chat</span>
            </Row>
          )}

          {dteMid != null && (
            <Row label="Expiry">
              <div className="flex gap-1.5">
                {[7, 14, 30, 45].map((d) => (
                  <button key={d} onClick={() => setDte(d)}
                    className={`border px-2 py-0.5 font-mono text-[13px] transition-colors ${
                      Math.abs((dteMid ?? 0) - d) <= 4 ? "border-mint text-mint" : "border-line text-fog hover:text-paper"
                    }`}>{d}d</button>
                ))}
              </div>
            </Row>
          )}

          {/* hard guardrails — the "careful with a big account" part */}
          <div className="mt-1.5 border-t border-line/60 pt-1.5">
            <div className="mb-1 font-mono text-[12.5px] uppercase tracking-[0.1em] text-fog">guardrails · the agent can never exceed these</div>
            <Row label="Max size">
              <span className="font-mono text-[13px] text-fog">$</span>
              <input type="number" min={0} step={100} placeholder="no cap"
                value={maxNotional ?? ""} onChange={(e) => setMaxNotional(e.target.value ? Number(e.target.value) : null)}
                className="w-28 border border-line bg-pane px-2 py-1 font-mono text-[13px] text-paper focus:border-mint focus:outline-none" />
              <span className="font-mono text-[13px] text-fog">notional the agent can ever hold</span>
            </Row>
            <Row label="Min premium">
              <input type="number" min={0} step={1} placeholder="auto"
                value={minYield != null ? Math.round(minYield * 100) : ""}
                onChange={(e) => setMinYield(e.target.value ? Number(e.target.value) : null)}
                className="w-20 border border-line bg-pane px-2 py-1 font-mono text-[13px] text-paper focus:border-mint focus:outline-none" />
              <span className="font-mono text-[13px] text-fog">% APR — skip if a cycle pays less</span>
            </Row>
          </div>

          <div className="mt-1.5 font-mono text-[12.5px] leading-relaxed text-fog">
            Defaults are sensible — tweak only if you want. {minYield != null && <>Won&apos;t sell below {fmtPct(minYield, 0)} APR. </>}
            {maxNotional != null && <>Capped at {fmtUsd(maxNotional)}. </>}
            Deploy sends this to dry-run first; nothing goes live until you sign.
          </div>
        </div>
      )}
    </div>
  );
}
