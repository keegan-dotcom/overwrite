import { useState, type ReactNode } from "react";
import type { StrategyPlan } from "../../lib/strategy/ir";
import { asset as assetInfo } from "../../data/appdata";
import { callPrice, putPrice, strikeForDelta, annualYield, fmtUsd, fmtPct } from "../../lib/options";

/**
 * Review & tune — the knobs you get AFTER the chat suggests a structure and
 * BEFORE you deploy. Smart defaults are pre-filled, so the simple path is
 * "glance → deploy". It adapts to the strategy:
 *   • covered / income  → size (% of holdings), strike (Δ), expiry
 *   • direct call / put  → contracts + a $-budget helper, strike, expiry
 *   • perps (degen)      → LEVERAGE slider (and the notional cap it implies)
 *   • all                → hard guardrails (max notional, min premium)
 * A LIVE readout recomputes premium / yield / breakeven / liquidation from the
 * current knobs as you drag — no need to redeploy to see what changes. Every
 * edit mutates the pending plan (the IR the executor runs).
 */
export function TuneCard({ plan, onChange }: { plan: StrategyPlan; onChange: (p: StrategyPlan) => void }) {
  const [open, setOpen] = useState(false);
  const sym = plan.asset.toUpperCase();
  const info = (() => { try { return assetInfo(sym); } catch { return null; } })();
  const spot = plan.spot?.[sym] ?? info?.spot ?? 0;
  const iv = info?.iv ?? 0.6;
  const held = (plan.holdings ?? [])
    .filter((h) => h.asset.toUpperCase() === sym).reduce((a, h) => a + h.amount, 0);
  const freeUsdc = plan.freeUsdc ?? 0;

  const perpLeg = plan.legs.find((l) => l.venue === "perp");
  const optLeg = plan.legs.find((l) => l.venue === "option" && l.option);
  const contractsLeg = plan.legs.find((l) => l.sizing.kind === "contracts");
  const pctLeg = plan.legs.find((l) => l.sizing.kind === "pct_of_collateral" || l.sizing.kind === "cash_secured");
  // strike defense only applies where there's a short option to roll
  const shortOptLeg = plan.legs.find((l) => l.venue === "option" && l.side === "sell");
  const defendPct = plan.manage?.defendProximityPct ?? null;

  const sizePct = pctLeg?.sizing.kind === "pct_of_collateral" ? pctLeg.sizing.pct
    : pctLeg?.sizing.kind === "cash_secured" ? (pctLeg.sizing.pct ?? 100) : null;
  const cashSecured = pctLeg?.sizing.kind === "cash_secured";
  const contracts = contractsLeg?.sizing.kind === "contracts" ? contractsLeg.sizing.amount : null;

  const delta = optLeg?.option?.strike.kind === "delta" ? optLeg.option.strike.target : null;
  const absStrike = optLeg?.option?.strike.kind === "absolute" ? optLeg.option.strike.price : null;
  const dteMid = optLeg?.option ? Math.round((optLeg.option.expiry.dteMin + optLeg.option.expiry.dteMax) / 2) : null;
  const maxNotional = plan.constraints.maxNotionalUsd ?? null;
  const minYield = plan.objective.targetYieldAnnual ?? null;
  // perp notional = leverage × margin base (real free USDC, else one unit of spot),
  // matching how the planner built it — so the slider reads and writes the same base.
  const marginBase = freeUsdc > 0 ? freeUsdc : spot;
  const leverage = perpLeg?.sizing.kind === "notional_usd" && marginBase > 0
    ? Math.min(20, Math.max(2, Math.round(perpLeg.sizing.usd / marginBase))) : null;

  /* ---- live preview: recompute the economics from the current knobs ------- */
  const preview = (() => {
    if (perpLeg && leverage != null) {
      return {
        kind: "perp" as const,
        lines: [
          { k: "Leverage", v: `${leverage}×` },
          { k: "Notional", v: `${fmtUsd(leverage * marginBase)} (capped)` },
          { k: "Liquidation", v: `~±${(100 / leverage).toFixed(0)}% move against you` },
        ],
      };
    }
    if (optLeg?.option && dteMid) {
      const isCall = optLeg.option.type === "C";
      const isSell = optLeg.side === "sell";
      const t = Math.max(1, dteMid) / 365;
      // strike from the current knob (absolute wins; else convert Δ → strike)
      const k = absStrike ?? (delta != null
        ? strikeForDelta(spot, isCall ? delta : 1 - delta, iv, t)
        : optLeg.option.strike.kind === "moneyness"
          ? spot * (1 + optLeg.option.strike.pct / 100) : spot);
      const prem = isCall ? callPrice(spot, k, iv, t) : putPrice(spot, k, iv, t);
      // how many contracts the current size implies
      const n = contracts != null ? contracts
        : pctLeg?.sizing.kind === "cash_secured" ? (freeUsdc * ((sizePct ?? 100) / 100)) / Math.max(1, k)
        : sizePct != null ? held * (sizePct / 100) : 1;
      const total = prem * n;
      const be = isCall ? k + prem : k - prem;
      const lines = [
        { k: "Strike", v: fmtUsd(k) },
        { k: "Premium", v: `${fmtUsd(prem, 2)}/contract · ${fmtUsd(total, 0)} total` },
        { k: "Break-even", v: `${fmtUsd(be)} at expiry` },
      ];
      if (isSell) lines.push({ k: "Yield", v: `~${fmtPct(annualYield(prem, spot, dteMid), 1)}/yr on notional` });
      else lines.push({ k: "Max loss", v: `${fmtUsd(total, 0)} (the premium you pay)` });
      if (isSell && defendPct != null) {
        lines.push({ k: "Defense", v: `auto-rolls ${isCall ? "up" : "down"} within ${Math.round(defendPct * 100)}% of strike` });
      }
      return { kind: "opt" as const, lines };
    }
    return null;
  })();

  /* ---- mutators (every one edits the deployable IR) ----------------------- */
  const clone = (): StrategyPlan => JSON.parse(JSON.stringify(plan));
  const setSize = (pct: number) => { const p = clone(); for (const l of p.legs) if (l.sizing.kind === "pct_of_collateral" || l.sizing.kind === "cash_secured") l.sizing.pct = pct; onChange(p); };
  const setContracts = (n: number) => { const p = clone(); for (const l of p.legs) if (l.sizing.kind === "contracts") l.sizing.amount = Math.max(0.1, Math.round(n * 10) / 10); onChange(p); };
  const setDelta = (target: number) => { const p = clone(); for (const l of p.legs) if (l.option?.strike.kind === "delta") l.option.strike.target = target; onChange(p); };
  const setDte = (d: number) => { const p = clone(); for (const l of p.legs) if (l.option) l.option.expiry = { dteMin: Math.max(2, d - 10), dteMax: d + 10 }; onChange(p); };
  const setLeverage = (lev: number) => {
    const p = clone();
    const usd = Math.round(lev * marginBase);
    for (const l of p.legs) if (l.venue === "perp" && l.sizing.kind === "notional_usd") l.sizing.usd = usd;
    p.constraints.maxNotionalUsd = usd; // the cap tracks the leverage
    onChange(p);
  };
  const setMaxNotional = (v: number | null) => { const p = clone(); if (v && v > 0) p.constraints.maxNotionalUsd = v; else delete p.constraints.maxNotionalUsd; onChange(p); };
  const setMinYield = (pct: number | null) => { const p = clone(); if (pct && pct > 0) p.objective.targetYieldAnnual = pct / 100; else delete p.objective.targetYieldAnnual; onChange(p); };
  const setDefend = (pct: number | null) => {
    const p = clone();
    if (pct != null && pct > 0) p.manage = { ...(p.manage ?? {}), defendProximityPct: pct };
    else if (p.manage) { delete p.manage.defendProximityPct; if (!Object.keys(p.manage).length) delete p.manage; }
    onChange(p);
  };

  const Row = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-24 shrink-0 font-mono text-[13px] uppercase tracking-[0.04em] text-fog">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  );

  // one-line summary for the collapsed header
  const summary = leverage != null ? `${leverage}× leverage`
    : [
        sizePct != null ? `${sizePct}%${cashSecured ? " cash" : ` of ${sym}`}` : contracts != null ? `${contracts} contract${contracts === 1 ? "" : "s"}` : null,
        delta != null ? `${delta.toFixed(2)}Δ` : absStrike != null ? fmtUsd(absStrike) : null,
        dteMid != null ? `~${dteMid}d` : null,
        defendPct != null ? `defend ${Math.round(defendPct * 100)}%` : null,
      ].filter(Boolean).join(" · ");

  return (
    <div className="border-2 border-line bg-ink">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <span className="font-mono text-[13px] font-bold uppercase tracking-[0.08em] text-mint">Review &amp; tune</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[13.5px] text-paper">{summary || "ready"}</span>
        <span className="shrink-0 font-mono text-[13px] uppercase text-fog">{open ? "hide ▴" : "adjust ▾"}</span>
      </button>

      {/* live readout — always visible so you see the economics before expanding */}
      {preview && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-3 py-1.5">
          {preview.lines.map((l) => (
            <span key={l.k} className="font-mono text-[12.5px]">
              <span className="text-fog">{l.k}: </span><span className={preview.kind === "perp" ? "text-rose" : "text-paper"}>{l.v}</span>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="border-t border-line px-3 py-2">
          {/* LEVERAGE (perps) */}
          {leverage != null && (
            <Row label="Leverage">
              <input type="range" min={2} max={20} step={1} value={leverage}
                onChange={(e) => setLeverage(Number(e.target.value))} className="flex-1 accent-rose" />
              <span className="w-36 shrink-0 text-right font-mono text-[13px] text-paper">
                {leverage}× <span className="text-fog">· liq ~±{(100 / leverage).toFixed(0)}%</span>
              </span>
            </Row>
          )}

          {/* SIZE — % for covered, contracts for direct buys */}
          {sizePct != null && (
            <Row label="Size">
              <input type="range" min={10} max={100} step={5} value={sizePct}
                onChange={(e) => setSize(Number(e.target.value))} className="flex-1 accent-mint" />
              <span className="w-36 shrink-0 text-right font-mono text-[13px] text-paper">
                {sizePct}%{!cashSecured && held > 0 && <span className="text-fog"> · {fmtUsd(held * (sizePct / 100) * spot)}</span>}
              </span>
            </Row>
          )}
          {contracts != null && (
            <Row label="Size">
              <input type="range" min={0.1} max={20} step={0.1} value={Math.min(20, contracts)}
                onChange={(e) => setContracts(Number(e.target.value))} className="flex-1 accent-mint" />
              <span className="w-36 shrink-0 text-right font-mono text-[13px] text-paper">
                {contracts} contract{contracts === 1 ? "" : "s"}
              </span>
            </Row>
          )}

          {/* STRIKE */}
          {delta != null && (
            <Row label="Strike">
              <input type="range" min={0.1} max={0.6} step={0.05} value={delta}
                onChange={(e) => setDelta(Number(e.target.value))} className="flex-1 accent-mint" />
              <span className="w-36 shrink-0 text-right font-mono text-[13px] text-paper">
                {delta.toFixed(2)}Δ <span className="text-fog">{delta <= 0.2 ? "· far OTM" : delta >= 0.45 ? "· near ATM" : ""}</span>
              </span>
            </Row>
          )}
          {absStrike != null && (
            <Row label="Strike"><span className="font-mono text-[13px] text-paper">{fmtUsd(absStrike)}</span><span className="font-mono text-[13px] text-fog">— set the level in chat</span></Row>
          )}

          {/* EXPIRY */}
          {dteMid != null && (
            <Row label="Expiry">
              <div className="flex flex-wrap gap-1.5">
                {[7, 14, 30, 45, 90].map((d) => (
                  <button key={d} onClick={() => setDte(d)}
                    className={`border px-2 py-0.5 font-mono text-[13px] transition-colors ${
                      Math.abs((dteMid ?? 0) - d) <= 4 ? "border-mint text-mint" : "border-line text-fog hover:text-paper"
                    }`}>{d}d</button>
                ))}
              </div>
            </Row>
          )}

          {/* STRIKE DEFENSE — roll the short strike away as price approaches */}
          {shortOptLeg && (
            <Row label="Defend">
              <button
                onClick={() => setDefend(defendPct != null ? null : 0.05)}
                className={`shrink-0 border px-2 py-0.5 font-mono text-[13px] uppercase transition-colors ${
                  defendPct != null ? "border-mint text-mint" : "border-line text-fog hover:text-paper"
                }`}
              >
                {defendPct != null ? "on" : "off"}
              </button>
              {defendPct != null ? (
                <>
                  <input type="range" min={2} max={15} step={1} value={Math.round(defendPct * 100)}
                    onChange={(e) => setDefend(Number(e.target.value) / 100)} className="flex-1 accent-mint" />
                  <span className="w-44 shrink-0 text-right font-mono text-[13px] text-paper">
                    within {Math.round(defendPct * 100)}% <span className="text-fog">· rolls {shortOptLeg.option?.type === "P" ? "down" : "up"} + out</span>
                  </span>
                </>
              ) : (
                <span className="font-mono text-[13px] text-fog">
                  auto-roll the strike {shortOptLeg.option?.type === "P" ? "lower" : "higher"} as price approaches — keeps your upside uncapped
                </span>
              )}
            </Row>
          )}

          {/* guardrails */}
          <div className="mt-1.5 border-t border-line/60 pt-1.5">
            <div className="mb-1 font-mono text-[12.5px] uppercase tracking-[0.1em] text-fog">guardrails · the agent can never exceed these</div>
            <Row label="Max size">
              <span className="font-mono text-[13px] text-fog">$</span>
              <input type="number" min={0} step={100} placeholder="no cap"
                value={maxNotional ?? ""} onChange={(e) => setMaxNotional(e.target.value ? Number(e.target.value) : null)}
                className="w-28 border border-line bg-pane px-2 py-1 font-mono text-[13px] text-paper focus:border-mint focus:outline-none" />
              <span className="font-mono text-[13px] text-fog">max notional the agent can hold</span>
            </Row>
            {!perpLeg && (
              <Row label="Min premium">
                <input type="number" min={0} step={1} placeholder="auto"
                  value={minYield != null ? Math.round(minYield * 100) : ""}
                  onChange={(e) => setMinYield(e.target.value ? Number(e.target.value) : null)}
                  className="w-20 border border-line bg-pane px-2 py-1 font-mono text-[13px] text-paper focus:border-mint focus:outline-none" />
                <span className="font-mono text-[13px] text-fog">% APR — skip a cycle that pays less</span>
              </Row>
            )}
          </div>

          <div className="mt-1.5 font-mono text-[12.5px] leading-relaxed text-fog">
            Defaults are sensible — tweak only if you want. Approve &amp; deploy takes it live immediately; pause or unwind anytime.
          </div>
        </div>
      )}
    </div>
  );
}
