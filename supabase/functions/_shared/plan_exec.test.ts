/**
 * Pure executor-core tests. Run:
 *   npx tsx supabase/functions/_shared/plan_exec.test.ts
 */
import {
  chooseOption, resolveAmount, coverageCap, priceLeg, dcaDue, callDeltaBS,
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
}

// ---- dcaDue ---------------------------------------------------------------
const now = 1_800_000_000_000;
check("DCA due after 8d (cadence 7)", dcaDue(7, now - 8 * 86400_000, now));
check("DCA not due after 3d (cadence 7)", !dcaDue(7, now - 3 * 86400_000, now));

// ---- callDeltaBS sanity ---------------------------------------------------
check("ATM call delta ≈ 0.5", Math.abs(callDeltaBS(4000, 4000, 0.6, 0.08) - 0.5) < 0.08);
check("deep OTM call delta < 0.2", callDeltaBS(4000, 6000, 0.6, 0.08) < 0.2);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
