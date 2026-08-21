/**
 * Overwrite Strategy IR — the typed, execution-agnostic representation of a
 * trading plan. Everything downstream operates on this, never on free text:
 *   - the planner (P2, an LLM) emits ONLY a StrategyPlan,
 *   - the validator (validate.ts) accepts/rejects/normalizes it,
 *   - the executor (the fleet) interprets it into venue orders.
 *
 * The current covered-call fleet is one special case of this: a single short
 * call leg sized to collateral, plus an optional recurring spot buy (sweep).
 */

export type Venue = "spot" | "option" | "perp";
export type Side = "buy" | "sell";
export type OptionType = "C" | "P";

/** How big a leg is. Kept declarative so the executor resolves it at run time
 * against live collateral / marks, and the validator can reason about it. */
export type Sizing =
  | { kind: "contracts"; amount: number }
  | { kind: "notional_usd"; usd: number }
  | { kind: "pct_of_collateral"; pct: number } // e.g. cover 90% of held ETH
  | { kind: "cash_secured"; pct?: number }     // short puts sized to (pct% of) free USDC
  | { kind: "match_leg"; legId: string };      // size to another leg (spreads/collars)

export type StrikeRule =
  | { kind: "delta"; target: number }     // nearest |delta| to target
  | { kind: "absolute"; price: number }   // exact strike price
  | { kind: "moneyness"; pct: number };   // % OTM (+) / ITM (-) from spot

export interface OptionSpec {
  type: OptionType;
  expiry: { dteMin: number; dteMax: number };
  strike: StrikeRule;
}

export interface Leg {
  id: string;
  venue: Venue;
  asset: string;              // "ETH", "BTC", "XAUT"
  side: Side;
  sizing: Sizing;
  option?: OptionSpec;        // required iff venue === "option"
  orderType: "post_only" | "limit" | "ioc";
  reduceOnly?: boolean;
}

export interface Schedule {
  kind: "once" | "recurring";
  everyDays?: number;         // DCA cadence; required iff kind === "recurring"
}

export type ObjectiveKind =
  | "income" | "protect" | "accumulate" | "directional" | "neutral" | "collar";

export interface Objective {
  kind: ObjectiveKind;
  view?: "up" | "down" | "flat"; // stated directional view — used for coherence
  targetYieldAnnual?: number;
  protectionFloorUsd?: number;
  stopLossPct?: number;
}

export interface Constraints {
  maxNotionalUsd?: number;
  maxSlippagePct?: number;
  maxLossUsd?: number;           // defined-risk cap
  requireDefinedRisk?: boolean;  // public/whitelisted tier → true
}

export interface StrategyPlan {
  asset: string;                 // primary underlying
  label: string;                 // human: "ETH covered-call income"
  objective: Objective;
  legs: Leg[];
  schedule: Schedule;
  constraints: Constraints;
  /** What the account is assumed to already hold, so the validator can reason
   * about coverage (e.g. a covered call needs the underlying). Optional; the
   * executor fills this from live collateral at run time. */
  holdings?: { asset: string; amount: number }[];
  /** Spot reference per asset, when known (for floor/moneyness sanity). */
  spot?: Record<string, number>;
  /** Available USDC collateral, for cash-secured sizing + feasibility checks. */
  freeUsdc?: number;
  /** Active-management knobs the fleet reads at run time. */
  manage?: {
    /** Roll a short option up/out (call) or down/out (put) once spot comes
     * within this fraction of the strike, e.g. 0.05 = 5%. Repeats until killed. */
    defendProximityPct?: number;
  };
}

/** What Derive actually lists per asset — the executor supplies the live map;
 * the validator refuses legs on venues an asset doesn't support. */
export interface Capabilities {
  [asset: string]: { spot: boolean; option: boolean; perp: boolean };
}

/** Coarse per-unit directional sign of a leg's delta exposure, used ONLY for
 * coherence (does the net exposure match the stated view?). Not a pricing
 * delta — magnitudes are nominal; signs are what matter. */
export function legDeltaSign(leg: Leg): number {
  const dir = leg.side === "buy" ? 1 : -1;
  switch (leg.venue) {
    case "spot":
    case "perp":
      return dir;                                   // long +, short -
    case "option": {
      const base = leg.option?.type === "P" ? -1 : 1; // call +, put -
      return dir * base;                             // short call -, long put -, etc.
    }
  }
}
