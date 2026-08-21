/**
 * Pure decision core for the IR executor — NO I/O, NO npm imports, so it runs
 * identically in Deno (the fleet) and Node (tests). The fleet does the venue
 * calls (get_instruments / get_ticker / order) and hands the data to these
 * functions; all the arithmetic that's easy to get wrong lives here and is
 * unit-tested in plan_exec.test.ts.
 */
import type { Leg, StrategyPlan } from "./strategy.ts";

/** Black-Scholes call delta (N(d1)); put delta = this - 1. Injected/duplicated
 * here so this module stays import-free. */
export function callDeltaBS(s: number, k: number, v: number, t: number): number {
  const erf = (x: number) => {
    const sgn = x < 0 ? -1 : 1; x = Math.abs(x);
    const tt = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * tt - 1.453152027) * tt) + 1.421413741) * tt - 0.284496736) * tt + 0.254829592) * tt * Math.exp(-x * x);
    return sgn * y;
  };
  const cdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
  if (t <= 0) return s > k ? 1 : 0;
  return cdf((Math.log(s / k) + 0.5 * v * v * t) / (v * Math.sqrt(t)));
}

export interface OptCand {
  instrument_name: string;
  option_details: { strike: number | string; expiry: number; option_type: "C" | "P" };
  [k: string]: unknown;
}

/** Choose the option instrument matching a leg spec from a candidate list that
 * is ALREADY filtered to the right type + DTE window. Pure. */
export function chooseOption(cands: OptCand[], leg: Leg, spotPx: number, nowS: number, iv = 0.6): OptCand | null {
  const spec = leg.option;
  if (!spec || !cands.length) return null;
  if (spec.strike.kind === "delta") {
    let best: OptCand | null = null, bestErr = Infinity;
    for (const c of cands) {
      const yrs = (c.option_details.expiry - nowS) / 86400 / 365;
      const cd = callDeltaBS(spotPx, Number(c.option_details.strike), iv, yrs);
      const delta = spec.type === "C" ? cd : cd - 1;
      const err = Math.abs(Math.abs(delta) - Math.abs(spec.strike.target));
      if (err < bestErr) { bestErr = err; best = c; }
    }
    return best;
  }
  const target = spec.strike.kind === "absolute" ? spec.strike.price : spotPx * (1 + spec.strike.pct / 100);
  let best: OptCand | null = null, bestErr = Infinity;
  for (const c of cands) {
    const err = Math.abs(Number(c.option_details.strike) - target);
    if (err < bestErr) { bestErr = err; best = c; }
  }
  return best;
}

export interface AccountView {
  held: (asset: string) => number;       // base units held as collateral
  spot: Record<string, number>;          // index price per asset
}

/** Resolve a leg's order size in base units / contracts. Pure. */
export function resolveAmount(leg: Leg, plan: StrategyPlan, acct: AccountView, refPx: number): number {
  const s = leg.sizing;
  if (s.kind === "contracts") return s.amount;
  if (s.kind === "pct_of_collateral") return acct.held(leg.asset) * (s.pct / 100);
  if (s.kind === "notional_usd") {
    const underlying = acct.spot[leg.asset.toUpperCase()] ?? refPx;
    return underlying > 0 ? s.usd / underlying : 0;
  }
  // cash_secured needs the option strike, which only the executor has post
  // instrument-selection - it computes the size there. 0 here is the safe default.
  if (s.kind === "cash_secured") return 0;
  const ref = plan.legs.find((l) => l.id === s.legId);
  return ref ? resolveAmount(ref, plan, acct, refPx) : 0;
}

/** Coverage cap for a covered short call: never sell more calls than the held
 * base (× utilisation) minus calls already short. Pure. */
export function coverageCap(heldBase: number, existingShortCalls: number, util = 0.9): number {
  return Math.max(0, heldBase * util - existingShortCalls);
}

export interface PriceInputs {
  maker: boolean; isBid: boolean;
  refMark: number; bid: number; ask: number; tickSz: number;
  minCrossFrac?: number;   // taker fair-value guard vs mark (default 0.9)
}
/** Compute a limit price + time-in-force for a leg. Maker legs rest without
 * crossing; taker legs cross a hair to fill via IOC — BUT only when the far
 * touch is within `minCrossFrac` of mark, so a taker order never dumps into a
 * lowball bid (or lifts a gouging ask). If the touch is unfair, the taker
 * degrades to a resting maker at a fair price: it fills when the book is
 * reasonable, and never makes a bad trade when it isn't. Pure. */
export function priceLeg(p: PriceInputs): { px: number; tif: "post_only" | "ioc" } {
  const { isBid, refMark, bid, ask, tickSz } = p;
  const frac = p.minCrossFrac ?? 0.9;
  const q = (v: number) => Math.floor(v / tickSz) * tickSz;
  // fair-value guard: cross only when the touch we'd hit exists AND is close to
  // mark. A MISSING touch (empty book on our side) is the critical case: an IOC
  // with nothing to cross is rejected by Derive as "Zero liquidity for market or
  // IOC/FOK order" (code 11009) — so instead of firing into the void we rest a
  // fair maker that fills when a quote arrives. Same when the touch is a lowball
  // bid / gouging ask.
  let maker = p.maker;
  if (!maker && refMark > 0) {
    if (!isBid && (bid <= 0 || bid < refMark * frac)) maker = true;        // no bid, or too low to sell into
    if (isBid && (ask <= 0 || ask > refMark * (2 - frac))) maker = true;   // no ask, or too high to buy into
  }
  let px: number;
  let tif: "post_only" | "ioc";
  if (maker) {
    tif = "post_only";
    if (isBid) {
      px = q(Math.min(refMark || bid, bid || refMark));
      if (ask > 0 && px >= ask) px = ask - tickSz;         // don't cross
    } else {
      px = q(Math.max(refMark, ask || refMark));
      if (px <= bid) px = bid + tickSz;                    // stay above best bid
    }
  } else {
    tif = "ioc";
    px = isBid ? q((ask || refMark) * 1.003) : q((bid || refMark) * 0.997);
    if (isBid && ask > 0 && px < ask) px = px + tickSz;    // ensure it crosses
  }
  return { px, tif };
}

/** Has a recurring (DCA) leg's cadence elapsed? Pure. */
export function dcaDue(everyDays: number, lastRunMs: number, nowMs: number): boolean {
  return nowMs - lastRunMs >= everyDays * 86400_000;
}
