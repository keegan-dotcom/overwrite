/**
 * Strategy IR + coherence validator — Deno/edge copy.
 * Mirrors web/src/lib/strategy/{ir,validate}.ts exactly (kept in sync by hand;
 * the two runtimes bundle differently so they can't share one file yet). This
 * is the copy the EXECUTOR runs: every plan is validated here before any leg
 * is placed, so an incoherent plan can never reach the venue even if the
 * client-side check is bypassed.
 */

export type Venue = "spot" | "option" | "perp";
export type Side = "buy" | "sell";
export type OptionType = "C" | "P";

export type Sizing =
  | { kind: "contracts"; amount: number }
  | { kind: "notional_usd"; usd: number }
  | { kind: "pct_of_collateral"; pct: number }
  | { kind: "cash_secured"; pct?: number } // short puts sized to (pct% of) free USDC
  | { kind: "match_leg"; legId: string };

export type StrikeRule =
  | { kind: "delta"; target: number }
  | { kind: "absolute"; price: number }
  | { kind: "moneyness"; pct: number };

export interface OptionSpec {
  type: OptionType;
  expiry: { dteMin: number; dteMax: number };
  strike: StrikeRule;
}
export interface Leg {
  id: string;
  venue: Venue;
  asset: string;
  side: Side;
  sizing: Sizing;
  option?: OptionSpec;
  orderType: "post_only" | "limit" | "ioc";
  reduceOnly?: boolean;
}
export interface Schedule { kind: "once" | "recurring"; everyDays?: number; }
export type ObjectiveKind =
  | "income" | "protect" | "accumulate" | "directional" | "neutral" | "collar";
export interface Objective {
  kind: ObjectiveKind;
  view?: "up" | "down" | "flat";
  targetYieldAnnual?: number;
  protectionFloorUsd?: number;
  stopLossPct?: number;
}
export interface Constraints {
  maxNotionalUsd?: number;
  maxSlippagePct?: number;
  maxLossUsd?: number;
  requireDefinedRisk?: boolean;
}
export interface StrategyPlan {
  asset: string;
  label: string;
  objective: Objective;
  legs: Leg[];
  schedule: Schedule;
  constraints: Constraints;
  holdings?: { asset: string; amount: number }[];
  spot?: Record<string, number>;
  freeUsdc?: number; // available USDC collateral, for cash-secured sizing + feasibility
}
export interface Capabilities {
  [asset: string]: { spot: boolean; option: boolean; perp: boolean };
}

export function legDeltaSign(leg: Leg): number {
  const dir = leg.side === "buy" ? 1 : -1;
  switch (leg.venue) {
    case "spot":
    case "perp":
      return dir;
    case "option": {
      const base = leg.option?.type === "P" ? -1 : 1;
      return dir * base;
    }
  }
}

export type Severity = "error" | "warning";
export interface Issue { code: string; severity: Severity; message: string; legId?: string; }
export interface ValidationResult { ok: boolean; issues: Issue[]; errors: Issue[]; warnings: Issue[]; }

const err = (code: string, message: string, legId?: string): Issue => ({ code, severity: "error", message, legId });
const warn = (code: string, message: string, legId?: string): Issue => ({ code, severity: "warning", message, legId });

function netDeltaSign(plan: StrategyPlan): number {
  let net = 0;
  for (const leg of plan.legs) {
    const nominal =
      leg.sizing.kind === "notional_usd" ? leg.sizing.usd
      : leg.sizing.kind === "contracts" ? leg.sizing.amount
      : leg.sizing.kind === "pct_of_collateral" ? leg.sizing.pct / 100
      : 1;
    const w = leg.venue === "option" ? 0.35 : 1;
    net += legDeltaSign(leg) * nominal * w;
  }
  return net;
}
function heldAmount(plan: StrategyPlan, asset: string): number {
  return (plan.holdings ?? [])
    .filter((h) => h.asset.toUpperCase() === asset.toUpperCase())
    .reduce((a, h) => a + h.amount, 0);
}
function isUndefinedRiskLeg(plan: StrategyPlan, leg: Leg): boolean {
  if (leg.venue === "perp") return true;
  if (leg.venue === "option" && leg.side === "sell") {
    if (leg.option?.type === "C") return heldAmount(plan, leg.asset) <= 0;
    // short put is bounded when it's cash-secured (or has an explicit maxLoss)
    if (leg.sizing.kind === "cash_secured") return false;
    return plan.constraints.maxLossUsd == null;
  }
  return false;
}

export function validatePlan(plan: StrategyPlan, caps?: Capabilities): ValidationResult {
  const issues: Issue[] = [];
  if (!plan.legs.length) issues.push(err("no_legs", "Plan has no legs to execute."));
  const ids = new Set<string>();
  for (const leg of plan.legs) {
    if (ids.has(leg.id)) issues.push(err("dup_leg_id", `Duplicate leg id "${leg.id}".`, leg.id));
    ids.add(leg.id);
    if (leg.venue === "option" && !leg.option) issues.push(err("option_missing_spec", "Option leg has no option spec.", leg.id));
    if (leg.venue !== "option" && leg.option) issues.push(warn("spurious_option_spec", "Non-option leg carries an option spec (ignored).", leg.id));
    if (leg.sizing.kind === "pct_of_collateral" && leg.sizing.pct > 100) issues.push(err("oversized", `Leg sizes to ${leg.sizing.pct}% of collateral (>100%).`, leg.id));
    if (leg.sizing.kind === "match_leg") {
      const refId = leg.sizing.legId;
      if (!plan.legs.some((l) => l.id === refId)) issues.push(err("bad_leg_ref", `Leg references unknown leg "${refId}".`, leg.id));
    }
  }
  if (caps) {
    for (const leg of plan.legs) {
      const c = caps[leg.asset.toUpperCase()];
      if (!c) issues.push(warn("unknown_asset", `No capability info for ${leg.asset}; can't confirm it's listed.`, leg.id));
      else if (!c[leg.venue]) issues.push(err("venue_unavailable", `Derive has no ${leg.venue} market for ${leg.asset}.`, leg.id));
    }
  }
  const view = plan.objective.view;
  if (view === "up" || view === "down") {
    const net = netDeltaSign(plan);
    const wantPositive = view === "up";
    if (wantPositive && net <= 1e-9) issues.push(err("view_delta_mismatch", `Objective is bullish (view: up) but the legs are net ${net < 0 ? "short" : "flat"} delta — this plan doesn't express a long.`));
    if (!wantPositive && net >= -1e-9) issues.push(err("view_delta_mismatch", `Objective is bearish (view: down) but the legs are net ${net > 0 ? "long" : "flat"} delta — this plan doesn't express a short.`));
  }
  for (const leg of plan.legs) {
    const isShortCall = leg.venue === "option" && leg.side === "sell" && leg.option?.type === "C";
    const coversWithCollateral = leg.sizing.kind === "pct_of_collateral";
    if (isShortCall && (plan.objective.kind === "income" || coversWithCollateral)) {
      const held = heldAmount(plan, leg.asset);
      const sellsUnderlying = plan.legs.some((l) => l.venue === "spot" && l.side === "sell" && l.asset.toUpperCase() === leg.asset.toUpperCase());
      const buysUnderlying = plan.legs.some((l) => l.venue === "spot" && l.side === "buy" && l.asset.toUpperCase() === leg.asset.toUpperCase());
      if (held <= 0 && !buysUnderlying) issues.push(err("uncovered_call", `Covered call on ${leg.asset} but the account holds none and the plan doesn't buy it first — this is a NAKED short call.`, leg.id));
      if (sellsUnderlying) issues.push(err("cover_sold_away", `Can't run a covered call while also selling ${leg.asset} spot — selling the underlying removes the cover.`, leg.id));
    }
  }
  if (plan.objective.kind === "protect" && plan.objective.protectionFloorUsd != null) {
    const s = plan.spot?.[plan.asset.toUpperCase()];
    if (s != null && plan.objective.protectionFloorUsd >= s) issues.push(err("floor_above_spot", `Protection floor $${plan.objective.protectionFloorUsd} is at/above spot $${s} — you can't floor above the current price for free.`));
    const hasLongPut = plan.legs.some((l) => l.venue === "option" && l.side === "buy" && l.option?.type === "P");
    if (!hasLongPut) issues.push(warn("protect_no_put", "Objective is downside protection but there's no long put providing the floor."));
  }
  if (plan.objective.kind === "collar") {
    const longPut = plan.legs.some((l) => l.venue === "option" && l.side === "buy" && l.option?.type === "P");
    const shortCall = plan.legs.some((l) => l.venue === "option" && l.side === "sell" && l.option?.type === "C");
    if (!longPut || !shortCall) issues.push(err("collar_shape", "A collar needs a long put (floor) and a short call (finances it) against the held underlying."));
  }
  if (plan.schedule.kind === "recurring") {
    if (!plan.schedule.everyDays || plan.schedule.everyDays <= 0) issues.push(err("bad_cadence", "Recurring schedule needs a positive everyDays cadence."));
    const hasRepeatableBuy = plan.legs.some((l) => (l.venue === "spot" || l.venue === "perp") && l.side === "buy");
    if (!hasRepeatableBuy) issues.push(warn("dca_no_spot", "Recurring (DCA) plan has no spot/perp buy leg."));
  }
  // cash-secured feasibility (soft): a put needs ~strike cash per contract. If
  // free USDC is tiny, the executor will size it down or skip - say so up front.
  for (const leg of plan.legs) {
    if (leg.sizing.kind === "cash_secured" && plan.freeUsdc != null) {
      const s = plan.spot?.[leg.asset.toUpperCase()];
      const perContract = s ? s * 0.9 : undefined; // rough put strike
      if (perContract && plan.freeUsdc < perContract * 0.1) {
        issues.push(warn("thin_cash",
          `Only ~$${Math.round(plan.freeUsdc)} USDC free — the agent will size this put to what your cash secures (~${(plan.freeUsdc / perContract).toFixed(2)} contracts) or skip it if that's below Derive's minimum. This account fits a covered call on what you already hold better than a wheel.`));
      }
    }
  }
  if (plan.constraints.requireDefinedRisk) {
    for (const leg of plan.legs) {
      if (isUndefinedRiskLeg(plan, leg)) issues.push(err("undefined_risk", `Defined-risk account, but ${leg.side} ${leg.venue}${leg.option ? " " + leg.option.type : ""} on ${leg.asset} can lose more than posted.`, leg.id));
    }
    if (plan.constraints.maxLossUsd == null) issues.push(warn("no_max_loss", "Defined-risk account without an explicit maxLossUsd cap."));
  }
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  return { ok: errors.length === 0, issues, errors, warnings };
}
