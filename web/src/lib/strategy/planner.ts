/**
 * Planner — turns a parsed natural-language intent into a structured
 * StrategyPlan (the IR). This is the deterministic stand-in for the LLM seat:
 * same structured-output contract, so swapping in a model later is a drop-in.
 * Every plan it emits is run through the validator before it's shown or
 * deployed, so an incoherent mapping is caught here just like a bad LLM plan.
 */
import { ASSETS, DEMO_PORTFOLIO } from "../../data/appdata";
import type { ParsedIntent } from "../intent";
import { StrategyPlan, Leg, Capabilities } from "./ir";
import { validatePlan, ValidationResult } from "./validate";

const spotOf = (sym: string) => ASSETS.find((a) => a.symbol === sym.toUpperCase())?.spot ?? 0;

/** Which Derive venues each demo asset supports (mirrors the live registry the
 * executor uses; tokenized equities are options-only in this demo set). */
export const DEMO_CAPS: Capabilities = {
  BTC: { spot: true, option: true, perp: true },
  ETH: { spot: true, option: true, perp: true },
  HYPE: { spot: true, option: true, perp: true },
  XAUT: { spot: true, option: true, perp: false },
  SPX: { spot: false, option: true, perp: false },
  NVDA: { spot: false, option: true, perp: false },
  AAPL: { spot: false, option: true, perp: false },
};

function dteWindow(dte?: number): { dteMin: number; dteMax: number } {
  if (!dte) return { dteMin: 7, dteMax: 45 };
  return { dteMin: Math.max(3, dte - 15), dteMax: dte + 15 };
}

/** Build a StrategyPlan from a parsed intent. Pure — no I/O. */
export function planFromIntent(parsed: ParsedIntent): StrategyPlan {
  const asset = parsed.symbol.toUpperCase();
  const spot = spotOf(asset);
  const p = parsed.params;
  const dte = dteWindow(p.dte);
  const legs: Leg[] = [];
  let objectiveKind: StrategyPlan["objective"]["kind"] = "income";
  const objective: StrategyPlan["objective"] = { kind: "income" };
  const constraints: StrategyPlan["constraints"] = { requireDefinedRisk: true };
  let label = `${asset} covered-call income`;

  switch (parsed.strategyId) {
    case "income":
    case "neutral": {
      objectiveKind = "income";
      objective.kind = "income";
      objective.targetYieldAnnual = p.targetYieldAnnual;
      legs.push({
        id: "call", venue: "option", asset, side: "sell", orderType: "post_only",
        sizing: { kind: "pct_of_collateral", pct: 90 },
        option: {
          type: "C", expiry: dte,
          strike: p.capTarget && p.capTarget > spot
            ? { kind: "absolute", price: p.capTarget }
            : { kind: "delta", target: 0.25 },
        },
      });
      label = `${asset} covered-call income`;
      break;
    }
    case "wheel": {
      // cash-secured put — get paid to buy the dip. Bounded loss (strike), so
      // give the validator an explicit maxLoss so it clears the defined-risk gate.
      objectiveKind = "accumulate";
      objective.kind = "accumulate";
      const strike = p.capTarget && p.capTarget < spot ? p.capTarget : spot * 0.9;
      constraints.maxLossUsd = Math.round(strike);
      legs.push({
        id: "put", venue: "option", asset, side: "sell", orderType: "post_only",
        sizing: { kind: "contracts", amount: 1 },
        option: {
          type: "P", expiry: dte,
          strike: p.capTarget && p.capTarget < spot
            ? { kind: "absolute", price: p.capTarget }
            : { kind: "delta", target: 0.25 },
        },
      });
      label = `${asset} cash-secured put (wheel entry)`;
      break;
    }
    case "shield": {
      // protective put — floor the downside on the underlying you hold.
      objectiveKind = "protect";
      objective.kind = "protect";
      objective.protectionFloorUsd = p.capTarget && p.capTarget < spot ? p.capTarget : Math.round(spot * 0.9);
      legs.push({
        id: "put", venue: "option", asset, side: "buy", orderType: "ioc",
        sizing: { kind: "pct_of_collateral", pct: 100 },
        option: {
          type: "P", expiry: dte,
          strike: p.capTarget && p.capTarget < spot
            ? { kind: "absolute", price: p.capTarget }
            : { kind: "moneyness", pct: -10 },
        },
      });
      label = `${asset} protective put`;
      break;
    }
    case "bear": {
      // long put — defined-risk bearish (max loss = premium paid).
      objectiveKind = "directional";
      objective.kind = "directional";
      objective.view = "down";
      legs.push({
        id: "put", venue: "option", asset, side: "buy", orderType: "ioc",
        sizing: { kind: "contracts", amount: 1 },
        option: { type: "P", expiry: dte, strike: { kind: "delta", target: 0.35 } },
      });
      label = `${asset} long put (bearish)`;
      break;
    }
    case "collar": {
      // long put (floor) + short call (finances it) against the held underlying.
      objectiveKind = "collar";
      objective.kind = "collar";
      legs.push({
        id: "put", venue: "option", asset, side: "buy", orderType: "ioc",
        sizing: { kind: "pct_of_collateral", pct: 100 },
        option: { type: "P", expiry: dte, strike: { kind: "moneyness", pct: -10 } },
      });
      legs.push({
        id: "call", venue: "option", asset, side: "sell", orderType: "post_only",
        sizing: { kind: "match_leg", legId: "put" },
        option: { type: "C", expiry: dte, strike: { kind: "moneyness", pct: 10 } },
      });
      label = `${asset} zero-cost collar`;
      break;
    }
  }

  if (p.stopLossPct != null) objective.stopLossPct = p.stopLossPct;
  void objectiveKind;

  return {
    asset, label, objective, legs,
    schedule: { kind: "once" },
    constraints,
    spot: { [asset]: spot },
    // preview holdings so coverage checks (covered call / collar / shield) are
    // realistic client-side. The executor re-hydrates real holdings at run time.
    holdings: DEMO_PORTFOLIO.map((h) => ({ asset: h.symbol, amount: h.qty })),
  };
}

/** Plan + validate in one call — what the chat renders. */
export function planAndValidate(parsed: ParsedIntent): { plan: StrategyPlan; result: ValidationResult } {
  const plan = planFromIntent(parsed);
  const result = validatePlan(plan, DEMO_CAPS);
  return { plan, result };
}

/** One-line human summary of a plan's legs, for the chat. */
export function describePlan(plan: StrategyPlan): string {
  return plan.legs.map((l) => {
    const dir = l.side === "buy" ? "Buy" : "Sell";
    if (l.venue === "option" && l.option) {
      const k = l.option.strike;
      const strike = k.kind === "absolute" ? `$${k.price.toLocaleString()}`
        : k.kind === "delta" ? `${k.target}Δ`
        : `${k.pct > 0 ? "+" : ""}${k.pct}%`;
      return `${dir} ${l.option.type === "C" ? "call" : "put"} @ ${strike} (${l.option.expiry.dteMin}-${l.option.expiry.dteMax}d)`;
    }
    return `${dir} ${l.asset} ${l.venue}`;
  }).join(" + ");
}
