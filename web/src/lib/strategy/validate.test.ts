/**
 * Coherence-validator tests. Run: `npx tsx src/lib/strategy/validate.test.ts`
 * No test framework — pure asserts, non-zero exit on failure.
 */
import { validatePlan } from "./validate";
import { StrategyPlan, Leg, Capabilities } from "./ir";

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`FAIL  ${name}`); }
}
function hasErr(r: { errors: { code: string }[] }, code: string) {
  return r.errors.some((e) => e.code === code);
}

const CAPS: Capabilities = {
  ETH: { spot: true, option: true, perp: true },
  BTC: { spot: true, option: true, perp: true },
  XAUT: { spot: true, option: true, perp: false },
};

const leg = (l: Partial<Leg> & Pick<Leg, "id" | "venue" | "asset" | "side">): Leg => ({
  orderType: "post_only", sizing: { kind: "pct_of_collateral", pct: 90 }, ...l,
});

// ---- 1. a VALID covered call passes ---------------------------------------
{
  const plan: StrategyPlan = {
    asset: "ETH", label: "ETH covered-call income",
    objective: { kind: "income" },
    holdings: [{ asset: "ETH", amount: 2 }],
    legs: [leg({
      id: "call", venue: "option", asset: "ETH", side: "sell",
      option: { type: "C", expiry: { dteMin: 7, dteMax: 45 }, strike: { kind: "delta", target: 0.25 } },
    })],
    schedule: { kind: "once" }, constraints: {},
  };
  const r = validatePlan(plan, CAPS);
  check("valid covered call → ok", r.ok);
}

// ---- 2. "covered call by selling ETH" → rejected --------------------------
{
  const plan: StrategyPlan = {
    asset: "ETH", label: "bogus covered call",
    objective: { kind: "income" },
    holdings: [{ asset: "ETH", amount: 2 }],
    legs: [
      leg({ id: "call", venue: "option", asset: "ETH", side: "sell",
        option: { type: "C", expiry: { dteMin: 7, dteMax: 45 }, strike: { kind: "delta", target: 0.25 } } }),
      leg({ id: "sell-spot", venue: "spot", asset: "ETH", side: "sell",
        sizing: { kind: "contracts", amount: 2 } }),
    ],
    schedule: { kind: "once" }, constraints: {},
  };
  const r = validatePlan(plan, CAPS);
  check("covered call that sells the underlying → cover_sold_away", hasErr(r, "cover_sold_away"));
}

// ---- 3. "go long ETH by shorting the perp" → rejected ---------------------
{
  const plan: StrategyPlan = {
    asset: "ETH", label: "bullish but short",
    objective: { kind: "directional", view: "up" },
    legs: [leg({ id: "perp", venue: "perp", asset: "ETH", side: "sell",
      sizing: { kind: "notional_usd", usd: 1000 } })],
    schedule: { kind: "once" }, constraints: {},
  };
  const r = validatePlan(plan, CAPS);
  check("bullish view + short perp → view_delta_mismatch", hasErr(r, "view_delta_mismatch"));
}

// ---- 3b. a genuine long (spot buy) with bullish view passes ---------------
{
  const plan: StrategyPlan = {
    asset: "ETH", label: "long ETH",
    objective: { kind: "directional", view: "up" },
    legs: [leg({ id: "buy", venue: "spot", asset: "ETH", side: "buy",
      sizing: { kind: "notional_usd", usd: 1000 } })],
    schedule: { kind: "once" }, constraints: {},
  };
  check("bullish view + spot buy → ok", validatePlan(plan, CAPS).ok);
}

// ---- 4. naked short call (holds none, doesn't buy) → rejected --------------
{
  const plan: StrategyPlan = {
    asset: "ETH", label: "naked call",
    objective: { kind: "income" }, holdings: [],
    legs: [leg({ id: "call", venue: "option", asset: "ETH", side: "sell",
      option: { type: "C", expiry: { dteMin: 7, dteMax: 45 }, strike: { kind: "delta", target: 0.25 } } })],
    schedule: { kind: "once" }, constraints: {},
  };
  check("short call with no underlying → uncovered_call", hasErr(validatePlan(plan, CAPS), "uncovered_call"));
}

// ---- 5. protection floor above spot → rejected ----------------------------
{
  const plan: StrategyPlan = {
    asset: "ETH", label: "impossible floor",
    objective: { kind: "protect", protectionFloorUsd: 5000 },
    spot: { ETH: 4000 }, holdings: [{ asset: "ETH", amount: 2 }],
    legs: [leg({ id: "put", venue: "option", asset: "ETH", side: "buy",
      option: { type: "P", expiry: { dteMin: 7, dteMax: 45 }, strike: { kind: "moneyness", pct: -5 } } })],
    schedule: { kind: "once" }, constraints: {},
  };
  check("floor above spot → floor_above_spot", hasErr(validatePlan(plan, CAPS), "floor_above_spot"));
}

// ---- 6. venue unavailable (XAUT perp) → rejected --------------------------
{
  const plan: StrategyPlan = {
    asset: "XAUT", label: "gold perp",
    objective: { kind: "directional", view: "up" },
    legs: [leg({ id: "perp", venue: "perp", asset: "XAUT", side: "buy",
      sizing: { kind: "notional_usd", usd: 500 } })],
    schedule: { kind: "once" }, constraints: {},
  };
  check("XAUT perp (not listed) → venue_unavailable", hasErr(validatePlan(plan, CAPS), "venue_unavailable"));
}

// ---- 7. defined-risk tier rejects a perp leg ------------------------------
{
  const plan: StrategyPlan = {
    asset: "ETH", label: "perp on a safe account",
    objective: { kind: "directional", view: "up" },
    legs: [leg({ id: "perp", venue: "perp", asset: "ETH", side: "buy",
      sizing: { kind: "notional_usd", usd: 500 } })],
    schedule: { kind: "once" }, constraints: { requireDefinedRisk: true },
  };
  check("defined-risk account + perp → undefined_risk", hasErr(validatePlan(plan, CAPS), "undefined_risk"));
}

// ---- 8. a valid collar passes ---------------------------------------------
{
  const plan: StrategyPlan = {
    asset: "ETH", label: "ETH collar",
    objective: { kind: "collar" }, holdings: [{ asset: "ETH", amount: 4 }],
    spot: { ETH: 4000 },
    legs: [
      leg({ id: "put", venue: "option", asset: "ETH", side: "buy",
        option: { type: "P", expiry: { dteMin: 20, dteMax: 45 }, strike: { kind: "moneyness", pct: -10 } } }),
      leg({ id: "call", venue: "option", asset: "ETH", side: "sell",
        option: { type: "C", expiry: { dteMin: 20, dteMax: 45 }, strike: { kind: "moneyness", pct: 10 } } }),
    ],
    schedule: { kind: "once" }, constraints: {},
  };
  const r = validatePlan(plan, CAPS);
  check("valid collar → ok", r.ok);
}

// ---- 9. DCA (recurring spot buy) passes -----------------------------------
{
  const plan: StrategyPlan = {
    asset: "BTC", label: "weekly BTC DCA",
    objective: { kind: "accumulate" },
    legs: [leg({ id: "buy", venue: "spot", asset: "BTC", side: "buy",
      sizing: { kind: "notional_usd", usd: 100 }, orderType: "ioc" })],
    schedule: { kind: "recurring", everyDays: 7 }, constraints: {},
  };
  check("weekly BTC DCA → ok", validatePlan(plan, CAPS).ok);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
