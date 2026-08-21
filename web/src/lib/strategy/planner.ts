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

/** Account context the planner sizes against (real balances on mainnet, demo
 * portfolio otherwise). */
export type AccountCtx = { holdings?: { asset: string; amount: number }[]; freeUsdc?: number };

/** Build a StrategyPlan from a parsed intent. Pure — no I/O. */
export function planFromIntent(parsed: ParsedIntent, account?: AccountCtx): StrategyPlan {
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
        // cross to fill when the bid is fair (executor gates on a fair-value
        // floor); a resting maker never fills on Derive's one-sided books.
        id: "call", venue: "option", asset, side: "sell", orderType: "ioc",
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
      // cash-secured put — get paid to buy the dip. Sized to free USDC (never
      // more than cash can secure), so it's genuinely defined-risk.
      objectiveKind = "accumulate";
      objective.kind = "accumulate";
      legs.push({
        id: "put", venue: "option", asset, side: "sell", orderType: "ioc",
        sizing: { kind: "cash_secured", pct: 100 },
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
    case "call":
    case "lotto": {
      // direct bullish bet — buy a call. Defined-risk (max loss = premium paid),
      // so it stays inside the defined-risk guard. Lotto just picks a far-OTM
      // strike. Explicit strike (capTarget) wins; else delta-target.
      const isLotto = parsed.strategyId === "lotto";
      objectiveKind = "directional";
      objective.kind = "directional";
      objective.view = "up";
      legs.push({
        id: "call", venue: "option", asset, side: "buy", orderType: "ioc",
        sizing: { kind: "contracts", amount: 1 },
        option: {
          type: "C", expiry: dte,
          strike: p.capTarget && p.capTarget > 0
            ? { kind: "absolute", price: p.capTarget }
            : { kind: "delta", target: isLotto ? 0.12 : 0.4 },
        },
      });
      label = isLotto ? `${asset} lotto calls` : `${asset} long calls`;
      break;
    }
    case "put": {
      // direct bearish bet — buy a put. Defined-risk (max loss = premium).
      objectiveKind = "directional";
      objective.kind = "directional";
      objective.view = "down";
      legs.push({
        id: "put", venue: "option", asset, side: "buy", orderType: "ioc",
        sizing: { kind: "contracts", amount: 1 },
        option: {
          type: "P", expiry: dte,
          strike: p.capTarget && p.capTarget > 0
            ? { kind: "absolute", price: p.capTarget }
            : { kind: "delta", target: 0.4 },
        },
      });
      label = `${asset} long puts`;
      break;
    }
    case "perp_long":
    case "perp_short": {
      // DEGEN: leveraged perp. NOT defined-risk (liquidation possible), so we
      // turn off the defined-risk guard and instead BOUND it with a notional cap
      // (the executor also enforces a free-margin buffer before it opens).
      const up = parsed.strategyId === "perp_long";
      const lev = Math.min(20, Math.max(2, Math.round(p.leverage ?? 3)));
      // notional = leverage × the cash you can post as margin (real free USDC on
      // mainnet; falls back to one unit of spot in the demo preview). The
      // executor ALSO enforces a free-margin buffer, so a too-high leverage is
      // capped to what margin actually allows.
      const marginBase = account?.freeUsdc && account.freeUsdc > 0 ? account.freeUsdc : spot;
      const notional = Math.round(lev * marginBase);
      objectiveKind = "directional";
      objective.kind = "directional";
      objective.view = up ? "up" : "down";
      constraints.requireDefinedRisk = false;
      constraints.maxNotionalUsd = notional;
      objective.stopLossPct = p.stopLossPct ?? 0.4;
      legs.push({
        id: "perp", venue: "perp", asset, side: up ? "buy" : "sell", orderType: "ioc",
        sizing: { kind: "notional_usd", usd: notional },
      });
      label = `${asset} ${lev}× ${up ? "long" : "short"} (perp)`;
      break;
    }
    case "strangle": {
      // DEGEN: naked short strangle — sell an OTM call AND an OTM put for premium.
      // Undefined risk on both tails, so the defined-risk guard is off. Objective
      // is "neutral" (range-bound) so the covered-call coverage check doesn't
      // fire (we're intentionally naked here).
      objectiveKind = "neutral";
      objective.kind = "neutral";
      constraints.requireDefinedRisk = false;
      legs.push({
        id: "call", venue: "option", asset, side: "sell", orderType: "ioc",
        sizing: { kind: "contracts", amount: 1 },
        option: { type: "C", expiry: dte, strike: { kind: "delta", target: 0.2 } },
      });
      legs.push({
        id: "put", venue: "option", asset, side: "sell", orderType: "ioc",
        sizing: { kind: "contracts", amount: 1 },
        option: { type: "P", expiry: dte, strike: { kind: "delta", target: 0.2 } },
      });
      label = `${asset} short strangle`;
      break;
    }
  }

  if (p.stopLossPct != null) objective.stopLossPct = p.stopLossPct;
  void objectiveKind;

  // account context: real balances on mainnet, demo portfolio otherwise, so the
  // validator sizes/feasibility-checks against what the account actually holds.
  // The executor re-hydrates real holdings + USDC at run time regardless.
  const holdings = account?.holdings
    ?? DEMO_PORTFOLIO.map((h) => ({ asset: h.symbol, amount: h.qty }));

  return {
    asset, label, objective, legs,
    schedule: { kind: "once" },
    constraints,
    spot: { [asset]: spot },
    holdings,
    ...(account?.freeUsdc != null ? { freeUsdc: account.freeUsdc } : {}),
  };
}

/** Plan + validate in one call — what the chat renders. */
export function planAndValidate(
  parsed: ParsedIntent, account?: AccountCtx,
): { plan: StrategyPlan; result: ValidationResult } {
  const plan = planFromIntent(parsed, account);
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
