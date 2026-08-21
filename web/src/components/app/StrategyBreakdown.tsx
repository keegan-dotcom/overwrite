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
  const perp = legs.find((l) => l.venue === "perp");

  // ---- title + one-line summary ------------------------------------------
  let title = plan?.label ?? `${asset} covered-call income`;
  let summary: string;
  if (perp && shortCall) {
    summary = `You hold ${asset} and sell calls against it for income, while a short ${asset} perp cancels out the price swings — so you earn premium with roughly zero exposure to where ${asset} goes.`;
  } else if (longPut && shortCall) {
    summary = `A collar on your ${asset}: a bought put sets a floor under losses, and a sold call pays for that protection (and caps upside in return).`;
  } else if (longPut) {
    summary = `Downside insurance on your ${asset}: a bought put floors how far your ${asset} can fall.`;
  } else if (shortPut) {
    summary = `The wheel: you sell cash-secured ${asset} puts to earn premium, and if ${asset} dips to the strike you get assigned — you buy the ${asset} you wanted anyway, at a discount.`;
  } else {
    summary = `You hold ${asset}. Every cycle the agent sells a ${asset} call option against it and collects the premium as income. You keep your ${asset} and all the upside up to the call's strike.`;
  }

  // ---- the real knobs -----------------------------------------------------
  const rows: Row[] = [];
  rows.push({ k: "Asset", v: asset });
  rows.push({ k: "Strategy", v: title });
  const optLeg = shortCall ?? longPut ?? shortPut;
  if (optLeg?.option) {
    rows.push({ k: optLeg.side === "sell" ? "Sell strike" : "Buy strike", v: strikeEnglish(optLeg.option.strike) });
    const e = optLeg.option.expiry;
    if (e) rows.push({ k: "Expiry", v: `${e.dteMin}–${e.dteMax} days out, rolled each cycle` });
    rows.push({ k: "Size", v: sizeEnglish(optLeg.sizing, asset) });
  }
  if (perp) rows.push({ k: "Hedge", v: `short ${asset} perp, re-balanced as delta drifts` });
  const ty = plan?.objective?.targetYieldAnnual;
  if (ty) rows.push({ k: "Target income", v: `~${(ty * 100).toFixed(0)}%/yr in premium (not a guaranteed APY)` });
  if (cfg.min_yield != null) rows.push({ k: "Min yield floor", v: `skips any option paying under ${(cfg.min_yield * 100).toFixed(0)}%/yr` });
  if (cfg.take_profit_pct != null) rows.push({ k: "Take-profit", v: `buys the option back once ${(cfg.take_profit_pct * 100).toFixed(0)}% of the premium has decayed — locks the win in early` });
  if (cfg.sweep?.buy) rows.push({ k: "Premium sweep", v: `auto-buys ${String(cfg.sweep.buy).toUpperCase()} with collected premium` });
  const maxLoss = plan?.constraints?.maxLossUsd;
  rows.push({ k: "Max-loss cap", v: maxLoss != null ? `$${maxLoss.toLocaleString()} hard stop` : "none set" });

  // ---- ELI5 risk flags ----------------------------------------------------
  const flags: Flag[] = [];
  if (shortCall) {
    flags.push({ tone: "warn", text: `Upside is capped. If ${asset} rips above the call's strike, your gains stop there — you keep everything up to the strike, plus the premium, but miss the rest.` });
  }
  if ((shortCall || shortPut) && !longPut && !perp) {
    flags.push({ tone: "warn", text: `No downside protection. If ${asset} falls you still hold it and feel the drop — the premium you collect only softens it a little.` });
  }
  if (shortPut) {
    flags.push({ tone: "warn", text: `You can be assigned. If ${asset} drops below the put strike, you buy ${asset} at that strike using your USDC — fine if you wanted more ${asset}, a paper loss if it keeps falling.` });
  }
  if (longPut) {
    flags.push({ tone: "good", text: `Downside is floored. The bought put means there's a price below which you stop losing — that's your worst case (minus what the put cost).` });
  }
  if (perp) {
    flags.push({ tone: "warn", text: `The perp hedge has funding + liquidation risk. It costs (or pays) funding each hour, and a violent move can force it to de-lever. The agent watches funding and unwinds the hedge if it turns punitive.` });
  }
  flags.push({ tone: "info", text: `Income is real premium, not a fixed rate. It moves with ${asset}'s volatility — higher when markets are jumpy, lower when they're calm.` });
  if (plan?.constraints?.requireDefinedRisk && !perp) {
    flags.push({ tone: "good", text: `Defined risk. The agent can only trade against ${asset}/cash you actually hold — never a naked, borrowed, or leveraged position.` });
  }
  if (maxLoss == null) {
    flags.push({ tone: "warn", text: `No hard dollar stop-loss. Nothing auto-closes the position if ${asset} craters — tell the agent in chat (e.g. "close if down 15%") if you want a floor.` });
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
  if (!d) return null;

  return (
    <div className="border-2 border-line bg-pane">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b-2 border-line px-3 py-1.5">
        <span className="font-mono text-[12.5px] uppercase tracking-[0.14em] text-fog">What this agent is doing</span>
        <span className="min-w-0 flex-1" />
        <span className={`font-mono text-[12.5px] uppercase tracking-[0.1em] ${live ? "text-mint" : killed ? "text-rose" : "text-amber"}`}>
          {live ? "● live" : killed ? "● paused (killed)" : "○ dry-run"}
        </span>
      </div>

      <div className="space-y-3 px-3 py-3">
        {/* the one sentence */}
        <p className="font-serif text-[15px] leading-relaxed text-paper/95">{d.summary}</p>

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
      </div>
    </div>
  );
}
