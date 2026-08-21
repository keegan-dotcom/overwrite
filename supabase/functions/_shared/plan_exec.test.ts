/**
 * Pure executor-core tests. Run:
 *   npx tsx supabase/functions/_shared/plan_exec.test.ts
 */
import {
  chooseOption, resolveAmount, coverageCap, priceLeg, dcaDue, callDeltaBS,
  manageDecision, optionDteDays, optionStrike,
  type OptCand,
} from "./plan_exec.ts";
import type { Leg, StrategyPlan } from "./strategy.ts";

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`FAIL  ${name}`); }
};

const nowS = 1_700_000_000;
const mkCand = (strike: number, type: "C" | "P", dteDays = 30): OptCand => ({
  instrument_name: `ETH-${strike}-${type}`,
  option_details: { strike, type: type as any, option_type: type, expiry: nowS + dteDays * 86400 } as any,
});
const leg = (l: Partial<Leg> & Pick<Leg, "id" | "venue" | "asset" | "side">): Leg => ({
  orderType: "post_only", sizing: { kind: "contracts", amount: 1 }, ...l,
});

// ---- chooseOption: delta target picks an OTM strike, not ATM --------------
{
  const cands = [mkCand(4000, "C"), mkCand(4500, "C"), mkCand(5000, "C")];
  const l = leg({ id: "c", venue: "option", asset: "ETH", side: "sell",
    option: { type: "C", expiry: { dteMin: 7, dteMax: 45 }, strike: { kind: "delta", target: 0.25 } } });
  const pick = chooseOption(cands, l, 4000, nowS)!;
  check("delta 0.25 call → OTM strike (>= 4500)", Number(pick.option_details.strike) >= 4500);
}
// ---- chooseOption: moneyness picks nearest strike --------------------------
{
  const cands = [mkCand(3800, "P"), mkCand(3600, "P"), mkCand(3400, "P")];
  const l = leg({ id: "p", venue: "option", asset: "ETH", side: "buy",
    option: { type: "P", expiry: { dteMin: 7, dteMax: 45 }, strike: { kind: "moneyness", pct: -10 } } });
  const pick = chooseOption(cands, l, 4000, nowS)!;
  check("moneyness -10% of 4000 → 3600", Number(pick.option_details.strike) === 3600);
}
// ---- chooseOption: absolute picks nearest strike --------------------------
{
  const cands = [mkCand(4000, "C"), mkCand(4200, "C"), mkCand(4500, "C")];
  const l = leg({ id: "c", venue: "option", asset: "ETH", side: "sell",
    option: { type: "C", expiry: { dteMin: 7, dteMax: 45 }, strike: { kind: "absolute", price: 4200 } } });
  const pick = chooseOption(cands, l, 4000, nowS)!;
  check("absolute 4200 → 4200", Number(pick.option_details.strike) === 4200);
}

// ---- resolveAmount --------------------------------------------------------
{
  const plan = { legs: [] } as unknown as StrategyPlan;
  const acct = { held: (a: string) => (a.toUpperCase() === "ETH" ? 4 : 0), spot: { ETH: 4000 } };
  check("contracts → literal", resolveAmount(leg({ id: "x", venue: "spot", asset: "ETH", side: "buy", sizing: { kind: "contracts", amount: 2 } }), plan, acct, 4000) === 2);
  check("pct_of_collateral 90% of 4 → 3.6", resolveAmount(leg({ id: "x", venue: "option", asset: "ETH", side: "sell", sizing: { kind: "pct_of_collateral", pct: 90 } }), plan, acct, 4000) === 3.6);
  check("notional $1000 @ 4000 → 0.25", resolveAmount(leg({ id: "x", venue: "spot", asset: "ETH", side: "buy", sizing: { kind: "notional_usd", usd: 1000 } }), plan, acct, 4000) === 0.25);
}
{
  const put = leg({ id: "put", venue: "option", asset: "ETH", side: "buy", sizing: { kind: "pct_of_collateral", pct: 50 } });
  const call = leg({ id: "call", venue: "option", asset: "ETH", side: "sell", sizing: { kind: "match_leg", legId: "put" } });
  const plan = { legs: [put, call] } as unknown as StrategyPlan;
  const acct = { held: (_: string) => 4, spot: { ETH: 4000 } };
  check("match_leg mirrors referenced size (2)", resolveAmount(call, plan, acct, 4000) === 2);
}

// ---- coverageCap ----------------------------------------------------------
check("coverageCap 4 held, none short → 3.6", coverageCap(4, 0, 0.9) === 3.6);
check("coverageCap fully short → 0", coverageCap(4, 3.6, 0.9) === 0);

// ---- priceLeg -------------------------------------------------------------
{
  const sell = priceLeg({ maker: true, isBid: false, refMark: 100, bid: 95, ask: 105, tickSz: 1 });
  check("maker sell rests above bid, post_only", sell.tif === "post_only" && sell.px > 95);
  const buy = priceLeg({ maker: true, isBid: true, refMark: 100, bid: 95, ask: 105, tickSz: 1 });
  check("maker buy rests below ask, post_only", buy.tif === "post_only" && buy.px < 105);
  const iocBuy = priceLeg({ maker: false, isBid: true, refMark: 100, bid: 95, ask: 105, tickSz: 1 });
  check("ioc buy crosses ask", iocBuy.tif === "ioc" && iocBuy.px >= 105);
  const iocSell = priceLeg({ maker: false, isBid: false, refMark: 100, bid: 95, ask: 105, tickSz: 1 });
  check("ioc sell crosses bid", iocSell.tif === "ioc" && iocSell.px <= 95);
  // no-liquidity guard: an IOC with no touch to cross must degrade to a resting
  // fair maker (else Derive rejects it 11009 "Zero liquidity").
  const noBid = priceLeg({ maker: false, isBid: false, refMark: 100, bid: 0, ask: 105, tickSz: 1 });
  check("sell into empty bid → rests post_only at/above mark", noBid.tif === "post_only" && noBid.px >= 100);
  const noAsk = priceLeg({ maker: false, isBid: true, refMark: 100, bid: 95, ask: 0, tickSz: 1 });
  check("buy into empty ask → rests post_only at/below mark", noAsk.tif === "post_only" && noAsk.px <= 100);
  // a lowball bid still degrades to maker (unchanged behaviour)
  const lowball = priceLeg({ maker: false, isBid: false, refMark: 100, bid: 50, ask: 105, tickSz: 1 });
  check("sell into lowball bid → rests post_only", lowball.tif === "post_only");
}

// ---- dcaDue ---------------------------------------------------------------
const now = 1_800_000_000_000;
check("DCA due after 8d (cadence 7)", dcaDue(7, now - 8 * 86400_000, now));
check("DCA not due after 3d (cadence 7)", !dcaDue(7, now - 3 * 86400_000, now));

// ---- optionDteDays --------------------------------------------------------
{
  const nowMs = Date.UTC(2026, 7, 21, 8, 0, 0); // 2026-08-21 08:00 UTC
  check("dte parses ETH-20260828-2500-C → ~7d", Math.abs(optionDteDays("ETH-20260828-2500-C", nowMs) - 7) < 0.01);
  check("dte of a past expiry is negative", optionDteDays("ETH-20260820-2500-C", nowMs) < 0);
  check("non-option name → NaN", Number.isNaN(optionDteDays("ETH-PERP", nowMs)));
}

// ---- manageDecision -------------------------------------------------------
{
  // short sold at 10; tp 0.75 → close once mark ≤ 2.5
  check("TP fires when premium decayed 75%", manageDecision({ amount: -1, entry: 10, mark: 2.4, dteDays: 30, takeProfitPct: 0.75, rollDte: 21 }).close);
  check("TP holds while still rich", !manageDecision({ amount: -1, entry: 10, mark: 5, dteDays: 30, takeProfitPct: 0.75, rollDte: 21 }).close);
  check("roll fires inside 21 DTE", manageDecision({ amount: -1, entry: 10, mark: 9, dteDays: 18, takeProfitPct: 0.75, rollDte: 21 }).close);
  check("roll holds outside 21 DTE", !manageDecision({ amount: -1, entry: 10, mark: 9, dteDays: 30, takeProfitPct: 0.75, rollDte: 21 }).close);
  check("never manages a LONG", !manageDecision({ amount: 1, entry: 10, mark: 1, dteDays: 5, takeProfitPct: 0.75, rollDte: 21 }).close);
  check("no rules set → never closes", !manageDecision({ amount: -1, entry: 10, mark: 0.1, dteDays: 1 }).close);
}

// ---- optionStrike ---------------------------------------------------------
{
  check("strike parses ETH-20260925-2800-C → 2800", optionStrike("ETH-20260925-2800-C") === 2800);
  check("strike parses BTC-20260828-109000-C → 109000", optionStrike("BTC-20260828-109000-C") === 109000);
  check("strike of a perp name → NaN", Number.isNaN(optionStrike("ETH-PERP")));
}

// ---- manageDecision: strike defense (proximity roll) ----------------------
{
  const base = { amount: -1, entry: 60, dteDays: 40, takeProfitPct: 0.75, rollDte: 21, defendPct: 0.05 };
  // short CALL strike 2800, spot 2700 → within 5% (2660 threshold) → defend/roll up
  check("call defends when spot within 5% of strike", manageDecision({ ...base, mark: 90, spot: 2700, strike: 2800, optionType: "C" }).close);
  check("call holds when spot far below strike", !manageDecision({ ...base, mark: 20, spot: 2492, strike: 2800, optionType: "C" }).close);
  check("call defends when spot has blown through strike", manageDecision({ ...base, mark: 200, spot: 2950, strike: 2800, optionType: "C" }).close);
  // reason mentions rolling up
  check("call defend reason says roll up", manageDecision({ ...base, mark: 90, spot: 2700, strike: 2800, optionType: "C" }).reason.includes("roll up"));
  // short PUT strike 2400, spot 2450 → within 5% from above → defend/roll down
  check("put defends when spot within 5% of strike", manageDecision({ ...base, mark: 90, spot: 2450, strike: 2400, optionType: "P" }).close);
  check("put holds when spot far above strike", !manageDecision({ ...base, mark: 20, spot: 2800, strike: 2400, optionType: "P" }).close);
  // defense off (no defendPct) → old behavior, holds a rich near-strike call
  check("no defendPct → does not roll on proximity", !manageDecision({ amount: -1, entry: 60, mark: 90, dteDays: 40, takeProfitPct: 0.75, rollDte: 21, spot: 2700, strike: 2800, optionType: "C" }).close);
  // defense takes priority but TP still works when defense not triggered
  check("TP still fires with defense armed but spot far", manageDecision({ ...base, mark: 12, spot: 2492, strike: 2800, optionType: "C" }).close);
}

// ---- callDeltaBS sanity ---------------------------------------------------
check("ATM call delta ≈ 0.5", Math.abs(callDeltaBS(4000, 4000, 0.6, 0.08) - 0.5) < 0.08);
check("deep OTM call delta < 0.2", callDeltaBS(4000, 6000, 0.6, 0.08) < 0.2);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
