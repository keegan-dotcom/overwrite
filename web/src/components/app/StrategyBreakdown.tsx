import { useState } from "react";
import { HostedStatus } from "../../lib/hosted";

/**
 * Plain-English breakdown of the strategy that's ACTUALLY running, built from
 * the live deployed config (not from whatever the user typed at deploy time).
 * Three parts:
 *   1. one sentence: what this strategy does, in English
 *   2. the real knobs: the exact values the agent is running with
 *   3. ELI5 risk flags: what could go wrong, in words anyone can follow
 * So you can open the Console days later and know exactly what's on — and hand
 * the screen to someone non-technical and have them get it too.
 */

type Leg = {
  id?: string; side?: string; venue?: string; asset?: string;
  option?: { type?: string; expiry?: { dteMin?: number; dteMax?: number }; strike?: any };
  sizing?: any; orderType?: string;
};
type Plan = {
  label?: string; asset?: string;
  objective?: { kind?: string; targetYieldAnnual?: number; view?: string };
  constraints?: { requireDefinedRisk?: boolean; maxLossUsd?: number; maxNotionalUsd?: number };
  manage?: { defendProximityPct?: number };
  legs?: Leg[];
};
type Cfg = {
  plan?: Plan; symbol?: string; take_profit_pct?: number; min_yield?: number;
  sweep?: { buy?: string };
  [k: string]: unknown;
};

type Flag = { tone: "warn" | "good" | "info"; text: string };
type Row = { k: string; v: string };

/** Delta → how it feels, in English. */
function deltaEnglish(t: number): string {
  const d = Math.abs(t);
  if (d >= 0.5) return `~${Math.round(d * 100)}Δ · at-the-money — most premium, but the cap sits right around today's price`;
  if (d >= 0.35) return `~${Math.round(d * 100)}Δ · slightly out-of-the-money — strong premium, a little room to rise first`;
  if (d >= 0.2) return `~${Math.round(d * 100)}Δ · out-of-the-money — moderate premium, more room before the cap`;
  return `~${Math.round(d * 100)}Δ · far out-of-the-money — smaller premium, lots of upside room before the cap`;
}

function strikeEnglish(strike: any): string {
  if (!strike) return "—";
  if (strike.kind === "delta") return deltaEnglish(Number(strike.target ?? 0));
  if (strike.kind === "absolute") return `$${Number(strike.price).toLocaleString()} strike (fixed)`;
  if (strike.kind === "moneyness") return `${strike.pct > 0 ? "+" : ""}${strike.pct}% from spot`;
  return "—";
}

function sizeEnglish(sizing: any, asset: string): string {
  if (!sizing) return "—";
  if (sizing.kind === "pct_of_collateral") return `${sizing.pct}% of your ${asset}`;
  if (sizing.kind === "cash_secured") return `${sizing.pct ?? 100}% of your free USDC (cash-secured)`;
  if (sizing.kind === "contracts") return `${sizing.amount} contract${sizing.amount === 1 ? "" : "s"}`;
  if (sizing.kind === "notional_usd") return `~$${Number(sizing.usd).toLocaleString()} notional`;
  if (sizing.kind === "match_leg") return `matched to the ${sizing.legId} leg`;
  return "—";
}

/** Build the human summary + rows + risk flags from the live plan/config. */
function describe(cfg: Cfg): { title: string; summary: string; rows: Row[]; flags: Flag[] } | null {
  const plan = cfg.plan;
  const asset = (plan?.asset ?? cfg.symbol ?? "ETH").toUpperCase();
  const legs = plan?.legs ?? [];
  const obj = plan?.objective?.kind ?? "income";

  const shortCall = legs.find((l) => l.venue === "option" && l.side === "sell" && l.option?.type === "C");
  const shortPut = legs.find((l) => l.venue === "option" && l.side === "sell" && l.option?.type === "P");
  const longPut = legs.find((l) => l.venue === "option" && l.side === "buy" && l.option?.type === "P");
  const longCall = legs.find((l) => l.venue === "option" && l.side === "buy" && l.option?.type === "C");
  const perp = legs.find((l) => l.venue === "perp");
  const perpHedged = perp && (shortCall || shortPut);         // neutral: perp is a hedge
  const perpDirectional = perp && !shortCall && !shortPut;    // degen: perp IS the bet
  const isStrangle = shortCall && shortPut;                   // naked premium both sides
  const isProtect = obj === "protect";

  // ---- title + one-line summary ------------------------------------------
  let title = plan?.label ?? `${asset} covered-call income`;
  let summary: string;
  if (perpHedged) {
    summary = `You hold ${asset} and sell calls against it for income, while a short ${asset} perp cancels out the price swings — so you earn premium with roughly zero exposure to where ${asset} goes.`;
  } else if (perpDirectional) {
    summary = `A leveraged ${perp!.side === "buy" ? "LONG" : "SHORT"} on ${asset} via perps. Your P&L is amplified in both directions, and a hard enough move against you can be liquidated.`;
  } else if (isStrangle) {
    summary = `Selling premium on ${asset} both ways (a naked strangle): you pocket income while ${asset} stays in a range, and you're exposed if it breaks out hard in either direction.`;
  } else if (longPut && shortCall) {
    summary = `A collar on your ${asset}: a bought put sets a floor under losses, and a sold call pays for that protection (and caps upside in return).`;
  } else if (longCall) {
    summary = `A bullish bet on ${asset}: you bought calls. Upside is uncapped above the strike, and the most you can lose is the premium you paid.`;
  } else if (longPut && isProtect) {
    summary = `Downside insurance on your ${asset}: a bought put floors how far your ${asset} can fall while you keep all the upside.`;
  } else if (longPut) {
    summary = `A bearish bet on ${asset}: you bought puts. You profit as ${asset} falls, and the most you can lose is the premium you paid — no short-squeeze risk.`;
  } else if (shortPut) {
    summary = `The wheel: you sell cash-secured ${asset} puts to earn premium, and if ${asset} dips to the strike you get assigned — you buy the ${asset} you wanted anyway, at a discount.`;
  } else {
    summary = `You hold ${asset}. Every cycle the agent sells a ${asset} call option against it and collects the premium as income. You keep your ${asset} and all the upside up to the call's strike.`;
  }

  // ---- the real knobs -----------------------------------------------------
  const rows: Row[] = [];
  rows.push({ k: "Asset", v: asset });
  rows.push({ k: "Strategy", v: title });
  const optLeg = shortCall ?? longCall ?? longPut ?? shortPut;
  if (optLeg?.option) {
    rows.push({ k: optLeg.side === "sell" ? "Sell strike" : "Buy strike", v: strikeEnglish(optLeg.option.strike) });
    const e = optLeg.option.expiry;
    if (e) rows.push({ k: "Expiry", v: `${e.dteMin}–${e.dteMax} days out, rolled each cycle` });
    rows.push({ k: "Size", v: sizeEnglish(optLeg.sizing, asset) });
  }
  if (isStrangle && shortPut?.option) {
    rows.push({ k: "Put strike", v: strikeEnglish(shortPut.option.strike) });
  }
  if (perp) {
    const notional = perp.sizing.kind === "notional_usd" ? Number(perp.sizing.usd) : 0;
    rows.push({
      k: perpDirectional ? "Position" : "Hedge",
      v: perpDirectional
        ? `${perp.side === "buy" ? "long" : "short"} ${asset} perp${notional ? ` · up to ~$${notional.toLocaleString()} notional` : ""}`
        : `short ${asset} perp, re-balanced as delta drifts`,
    });
  }
  const ty = plan?.objective?.targetYieldAnnual;
  if (ty) rows.push({ k: "Target income", v: `~${(ty * 100).toFixed(0)}%/yr in premium (not a guaranteed APY)` });
  if (cfg.min_yield != null) rows.push({ k: "Min yield floor", v: `skips any option paying under ${(cfg.min_yield * 100).toFixed(0)}%/yr` });
  // active management (now enforced by the executor) — surface it for any
  // short-option strategy so people know the agent tends the position.
  if (shortCall || shortPut) {
    const tpPct = typeof cfg.take_profit_pct === "number" ? cfg.take_profit_pct : 0.75;
    rows.push({ k: "Take-profit", v: `buys it back automatically once ${Math.round(tpPct * 100)}% of the premium has decayed — locks the win in early` });
    const roll = typeof cfg.roll_dte === "number" ? cfg.roll_dte : 21;
    const shortDteMin = (shortCall ?? shortPut)?.option?.expiry?.dteMin ?? 0;
    if (shortDteMin > roll) rows.push({ k: "Auto-roll", v: `rolls out of the gamma zone at ~${roll} days to expiry, re-selling further out` });
  }
  // strike defense (proximity roll) — surfaced whenever it's armed
  const defendPct = plan?.manage?.defendProximityPct ?? (cfg as { defend_proximity_pct?: number }).defend_proximity_pct;
  if (typeof defendPct === "number" && defendPct > 0 && (shortCall || shortPut)) {
    const dir = shortCall ? "up" : "down";
    rows.push({ k: "Strike defense", v: `if ${asset} comes within ${(defendPct * 100).toFixed(0)}% of the ${shortCall ? "call" : "put"} strike, it buys the option back and re-sells ${dir} and further out — automatically, every time, until you kill it` });
  }
  if (cfg.sweep?.buy) rows.push({ k: "Premium sweep", v: `auto-buys ${String(cfg.sweep.buy).toUpperCase()} with collected premium` });
  const maxLoss = plan?.constraints?.maxLossUsd;
  rows.push({ k: "Max-loss cap", v: maxLoss != null ? `$${maxLoss.toLocaleString()} hard stop` : "none set" });

  // ---- ELI5 risk flags (strategy-aware) -----------------------------------
  const flags: Flag[] = [];
  if (perpDirectional) {
    flags.push({ tone: "warn", text: `Liquidation risk. This is leveraged — a hard enough move against you wipes the position, and you can lose more than a plain spot trade. The agent auto-closes at your stop, but a fast wick can blow through it.` });
    flags.push({ tone: "warn", text: `Funding cost. You pay (or earn) funding every hour to hold the perp; in a strong trend it adds up.` });
  } else if (isStrangle) {
    flags.push({ tone: "warn", text: `Undefined risk both ways. A big move past either strike loses more than the premium you took in — this is NAKED, not defined-risk.` });
    flags.push({ tone: "warn", text: `Best in calm, range-bound markets. Around a catalyst (news, unlock, earnings) it's dangerous.` });
    flags.push({ tone: "info", text: `You keep the full premium only if ${asset} finishes between the two strikes.` });
  } else if (perpHedged) {
    flags.push({ tone: "warn", text: `Upside is capped by the sold call, and the perp hedge carries funding + rebalancing cost — that drag is the price of staying market-neutral.` });
    flags.push({ tone: "info", text: `The point is yield with roughly zero price exposure — not a big win if ${asset} rips, not a big loss if it dumps.` });
  } else if (longCall) {
    flags.push({ tone: "good", text: `Defined risk. The most you can lose is the premium you paid — no liquidation, no assignment.` });
    flags.push({ tone: "warn", text: `Time decay + a move needed. ${asset} has to climb past the strike (plus the premium) before expiry, or the call bleeds toward zero.` });
  } else if (longPut && !shortCall) {
    if (isProtect) {
      flags.push({ tone: "good", text: `Downside floored. There's a price below which you stop losing — your worst case (minus the put's cost). Full upside kept.` });
      flags.push({ tone: "info", text: `Insurance costs premium each cycle; in calm markets that bleeds — the agent flags when it's not worth renewing.` });
    } else {
      flags.push({ tone: "good", text: `Defined risk. Max loss is the premium you paid — no short-squeeze, no liquidation.` });
      flags.push({ tone: "warn", text: `Time decay + a move needed. ${asset} has to fall past the strike before expiry, or the put decays toward zero.` });
    }
  } else {
    // covered call / collar / wheel family
    if (shortCall) {
      flags.push({ tone: "warn", text: `Upside is capped. Above the call's strike your gains stop — you keep everything up to it plus the premium, but miss the rest.` });
      if (!longPut) flags.push({ tone: "warn", text: `No downside protection. If ${asset} falls you still hold it and feel the drop — the premium only softens it a little.` });
    }
    if (shortPut) {
      flags.push({ tone: "warn", text: `You can be assigned. If ${asset} drops below the put strike, you buy it there with your USDC — fine if you wanted more ${asset}, a paper loss if it keeps falling.` });
    }
    if (longPut && shortCall) {
      flags.push({ tone: "good", text: `Downside is floored by the bought put — there's a level below which you stop losing.` });
    }
  }

  if (shortCall || shortPut) {
    flags.push({ tone: "info", text: `Premium is real income, not a fixed APY — it moves with ${asset}'s volatility, higher when markets are jumpy.` });
  }
  if (plan?.constraints?.requireDefinedRisk && !perp && !isStrangle) {
    flags.push({ tone: "good", text: `Defined risk. The agent can only trade against ${asset}/cash you actually hold — never a naked, borrowed, or leveraged position.` });
  }
  if (maxLoss == null && (perpDirectional || isStrangle)) {
    flags.push({ tone: "warn", text: `No hard dollar stop-loss set — add one in chat (e.g. "close if down 20%") to cap the damage.` });
  }
  if (typeof defendPct === "number" && defendPct > 0 && shortCall) {
    flags.push({ tone: "good", text: `Upside defense is ON. As ${asset} runs at the strike, the agent buys the call back and re-sells a higher one further out — so the cap keeps moving up with the market instead of stopping your gains. It repeats every cycle until you kill it. (Rolling up costs some of the premium, so income runs a bit lower in exchange for keeping the upside.)` });
  }

  return { title, summary, rows, flags };
}

const dot: Record<Flag["tone"], string> = { warn: "text-amber", good: "text-mint", info: "text-fog" };
const mark: Record<Flag["tone"], string> = { warn: "▲", good: "✓", info: "•" };

export function StrategyBreakdown({ st }: { st: HostedStatus }) {
  const cfg = (st.config ?? {}) as Cfg;
  const killed = (st as { kill?: boolean }).kill === true;
  const live = cfg.live === true && !killed;
  const d = describe(cfg);
  // collapsed by default — the header + one-sentence summary is enough to know
  // what's on at a glance; the full settings table + risk flags roll up so the
  // Console stays tight, and open on demand for the deep read.
  const [open, setOpen] = useState(false);
  if (!d) return null;

  return (
    <div className="border-2 border-line bg-pane">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 border-b-2 border-line px-3 py-1.5 text-left hover:bg-line/20"
      >
        <span className="font-mono text-[12.5px] uppercase tracking-[0.14em] text-fog">What this agent is doing</span>
        <span className={`font-mono text-[12.5px] uppercase tracking-[0.1em] ${live ? "text-mint" : killed ? "text-rose" : "text-amber"}`}>
          {live ? "● live" : killed ? "● paused (killed)" : "○ dry-run"}
        </span>
        <span className="min-w-0 flex-1" />
        <span className="font-mono text-[12px] uppercase tracking-[0.1em] text-fog">
          {open ? "hide details ▲" : "settings & risks ▼"}
        </span>
      </button>

      <div className="space-y-3 px-3 py-3">
        {/* the one sentence — always visible */}
        <p className="font-serif text-[15px] leading-relaxed text-paper/95">{d.summary}</p>

        {open && (
          <>
            {/* the real knobs */}
            <div className="border border-line">
              <div className="border-b border-line px-2.5 py-1 font-mono text-[12px] uppercase tracking-[0.12em] text-fog">
                The settings it's running with
              </div>
              <dl className="divide-y divide-line/60">
                {d.rows.map((r) => (
                  <div key={r.k} className="flex gap-3 px-2.5 py-1.5">
                    <dt className="w-28 shrink-0 font-mono text-[13px] uppercase tracking-[0.06em] text-fog">{r.k}</dt>
                    <dd className="min-w-0 flex-1 font-serif text-[14.5px] leading-snug text-paper/95">{r.v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* ELI5 risk flags */}
            <div className="border border-line">
              <div className="border-b border-line px-2.5 py-1 font-mono text-[12px] uppercase tracking-[0.12em] text-fog">
                What to know before you rely on it
              </div>
              <ul className="divide-y divide-line/60">
                {d.flags.map((f, i) => (
                  <li key={i} className="flex gap-2 px-2.5 py-1.5">
                    <span className={`shrink-0 font-mono text-[14px] leading-tight ${dot[f.tone]}`}>{mark[f.tone]}</span>
                    <span className="min-w-0 flex-1 font-serif text-[14.5px] leading-snug text-paper/95">{f.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
