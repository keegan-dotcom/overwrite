/**
 * Demo-app data: assets, the demo portfolio, and the productized strategy
 * catalog. Every quote is computed live from Black-Scholes (lib/options.ts)
 * so the numbers respond to real user targets - nothing is canned.
 */
import {
  Leg, annualYield, callPrice, putPrice, strikeForDelta, strikeForYield, fmtUsd, fmtPct,
} from "../lib/options";

export type Asset = {
  symbol: string;
  name: string;
  spot: number;   // demo pricing
  iv: number;     // IV30
  live: boolean;  // tradable on Derive today
  step: number;   // strike rounding
};

export const ASSETS: Asset[] = [
  { symbol: "BTC",  name: "Bitcoin",  spot: 98_400, iv: 0.38, live: true,  step: 500 },
  { symbol: "ETH",  name: "Ethereum", spot: 3_820,  iv: 0.50, live: true,  step: 50 },
  { symbol: "HYPE", name: "Hyperliquid", spot: 44.8, iv: 0.85, live: true, step: 1 },
  { symbol: "SPX",  name: "S&P 500 (tokenized)", spot: 6_310, iv: 0.165, live: false, step: 25 },
  { symbol: "NVDA", name: "Nvidia (tokenized)",  spot: 188,   iv: 0.445, live: false, step: 5 },
  { symbol: "AAPL", name: "Apple (tokenized)",   spot: 232,   iv: 0.22,  live: false, step: 5 },
];

export type Holding = { symbol: string; qty: number };
export const DEMO_PORTFOLIO: Holding[] = [
  { symbol: "BTC", qty: 1.2 },
  { symbol: "ETH", qty: 24 },
  { symbol: "HYPE", qty: 3_100 },
  { symbol: "SPX", qty: 15 },
];

export const asset = (sym: string) => ASSETS.find((a) => a.symbol === sym)!;
export const roundStrike = (k: number, a: Asset) => Math.round(k / a.step) * a.step;

/* ------------------------------------------------------------------ */
/* Strategy catalog: popular options strategies, productized.          */
/* ------------------------------------------------------------------ */

export type Quote = {
  strategyId: string;
  assetSymbol: string;
  title: string;
  legs: Leg[];             // per 1 unit of underlying
  assetQty: number;        // units of underlying held inside the position (0 or 1)
  dte: number;
  incomeMonthly: number;   // USD per unit per cycle (net premium)
  incomeAnnualPct: number; // annualized on spot (0 if not income strategy)
  capPrice: number | null; // upside capped past this price
  floorPrice: number | null; // protected below this price
  stopLossPct: number | null;
  headline: string;        // the one-line outcome
  tradeoffs: string[];     // plain-english full disclosure
  managed: string[];       // what the agent does automatically
};

export type Strategy = {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  fitsWhen: string;
  risk: "conservative" | "moderate" | "spicy";
  proName: string; // the real options name, shown small
  quote: (a: Asset, opts?: Partial<IntentParams>) => Quote;
};

export type IntentParams = {
  targetYieldAnnual: number; // e.g. 0.10
  capTarget: number | null;  // user's "$X upside target"
  stopLossPct: number | null;  // e.g. 0.15
  dte: number;
};

const DEF: IntentParams = { targetYieldAnnual: 0.10, capTarget: null, stopLossPct: null, dte: 35 };

function incomeQuote(a: Asset, o: Partial<IntentParams> = {}): Quote {
  const p = { ...DEF, ...o };
  const t = p.dte / 365;
  // strike priority: explicit cap target > solve for the yield target > 0.25Δ
  let k: number;
  if (p.capTarget != null) {
    k = p.capTarget;
  } else if (o.targetYieldAnnual != null) {
    k = strikeForYield(a.spot, o.targetYieldAnnual, a.iv, t) ?? strikeForDelta(a.spot, 0.25, a.iv, t);
  } else {
    k = strikeForDelta(a.spot, 0.25, a.iv, t);
  }
  k = roundStrike(Math.max(k, a.spot * 1.01), a);
  const prem = callPrice(a.spot, k, a.iv, t);
  const yld = annualYield(prem, a.spot, p.dte);
  return {
    strategyId: "income", assetSymbol: a.symbol, title: `Income Mode · ${a.symbol}`,
    legs: [{ kind: "call", side: "short", strike: k, premium: prem, qty: 1 }],
    assetQty: 1, dte: p.dte,
    incomeMonthly: prem, incomeAnnualPct: yld, capPrice: k, floorPrice: null,
    stopLossPct: p.stopLossPct,
    headline: `Earn ~${fmtPct(yld, 1)}/yr in income. You keep every dollar of upside until ${fmtUsd(k)}.`,
    tradeoffs: [
      `Above ${fmtUsd(k)} at expiry, gains are capped - you keep the climb to ${fmtUsd(k)} plus the premium, and give up anything beyond.`,
      `Downside is NOT protected: if ${a.symbol} falls, you still hold it. The premium (~${fmtUsd(prem, 2)}/unit per cycle) softens the fall slightly.`,
      p.stopLossPct ? `Auto-close: the whole position unwinds if it's down ${fmtPct(p.stopLossPct, 0)} from entry.` : "No stop-loss set - add one in chat ('close if down 15%').",
      "Income is real premium collected each ~monthly cycle; it is not a guaranteed APY.",
    ],
    managed: [
      "Re-sells a new call each cycle at your target",
      "Takes profit early at 75% premium decay",
      "Rolls at 21 days to expiry (gamma zone)",
      "If breached: rolls up only for a net credit, never a debit",
    ],
  };
}

function wheelQuote(a: Asset, o: Partial<IntentParams> = {}): Quote {
  const p = { ...DEF, ...o };
  const t = p.dte / 365;
  // ~30-delta put strike (call-delta 0.70 lands below spot), capped ≥3% below spot
  const putK = roundStrike(Math.min(strikeForDelta(a.spot, 0.70, a.iv, t), a.spot * 0.97), a);
  const prem = putPrice(a.spot, putK, a.iv, t);
  const yld = annualYield(prem, a.spot, p.dte);
  return {
    strategyId: "wheel", assetSymbol: a.symbol, title: `The Wheel · ${a.symbol}`,
    legs: [{ kind: "put", side: "short", strike: putK, premium: prem, qty: 1 }],
    assetQty: 0, dte: p.dte,
    incomeMonthly: prem, incomeAnnualPct: yld, capPrice: null, floorPrice: null,
    stopLossPct: p.stopLossPct,
    headline: `Get paid ~${fmtPct(yld, 1)}/yr while waiting to buy ${a.symbol} at ${fmtUsd(putK)} (${fmtPct(1 - putK / a.spot, 0)} below today).`,
    tradeoffs: [
      `Requires cash collateral (${fmtUsd(putK)}/unit) set aside in your vault.`,
      `If ${a.symbol} drops below ${fmtUsd(putK)}, you buy it there - even if the market price is lower. That's the deal: paid to place a limit order.`,
      "Once assigned, the wheel flips to Income Mode automatically (sell calls on the bag).",
      "In a crash you own the asset from the strike down - this is not downside protection.",
    ],
    managed: [
      "Re-sells a put each cycle while unassigned",
      "On assignment: switches to covered calls automatically",
      "Take-profit and 21-DTE roll rules apply on every leg",
    ],
  };
}

function shieldQuote(a: Asset, o: Partial<IntentParams> = {}): Quote {
  const p = { ...DEF, ...o };
  const t = p.dte / 365;
  const kFloor = roundStrike(p.capTarget ?? a.spot * 0.9, a); // reuse capTarget as floor target if given
  const cost = putPrice(a.spot, kFloor, a.iv, t);
  const costAnnual = annualYield(cost, a.spot, p.dte);
  return {
    strategyId: "shield", assetSymbol: a.symbol, title: `Downside Shield · ${a.symbol}`,
    legs: [{ kind: "put", side: "long", strike: kFloor, premium: cost, qty: 1 }],
    assetQty: 1, dte: p.dte,
    incomeMonthly: -cost, incomeAnnualPct: -costAnnual, capPrice: null, floorPrice: kFloor,
    stopLossPct: null,
    headline: `Your ${a.symbol} can't be worth less than ${fmtUsd(kFloor)} before ${p.dte}d expiry - full upside kept.`,
    tradeoffs: [
      `This is insurance and it costs real money: ~${fmtUsd(cost, 2)}/unit per ${p.dte}d (~${fmtPct(costAnnual, 1)}/yr drag if renewed forever).`,
      `Below ${fmtUsd(kFloor)} the put pays out dollar-for-dollar; between here and the floor you still take the loss.`,
      "Upside is fully kept - no cap.",
      "Renewing every cycle in calm markets bleeds premium; the agent will suggest dropping the shield when vol is expensive.",
    ],
    managed: [
      "Renews the put before expiry (with your approval)",
      "Suggests widening/narrowing the floor as vol changes",
      "Monetizes the put automatically after a crash (sells it when deep ITM)",
    ],
  };
}

function collarQuote(a: Asset, o: Partial<IntentParams> = {}): Quote {
  const p = { ...DEF, ...o };
  const t = p.dte / 365;
  const kCap = roundStrike(p.capTarget ?? strikeForDelta(a.spot, 0.25, a.iv, t), a);
  const callPrem = callPrice(a.spot, kCap, a.iv, t);
  // pick the put the call premium can pay for (zero-cost-ish collar)
  let kFloor = a.spot * 0.85;
  for (let i = 0; i < 40; i++) {
    const c = putPrice(a.spot, kFloor, a.iv, t);
    if (c > callPrem) kFloor -= a.spot * 0.005; else kFloor += a.spot * 0.005;
  }
  kFloor = roundStrike(Math.min(kFloor, a.spot * 0.99), a);
  const putCost = putPrice(a.spot, kFloor, a.iv, t);
  const net = callPrem - putCost;
  return {
    strategyId: "collar", assetSymbol: a.symbol, title: `Lock the Range · ${a.symbol}`,
    legs: [
      { kind: "call", side: "short", strike: kCap, premium: callPrem, qty: 1 },
      { kind: "put", side: "long", strike: kFloor, premium: putCost, qty: 1 },
    ],
    assetQty: 1, dte: p.dte,
    incomeMonthly: net, incomeAnnualPct: annualYield(net, a.spot, p.dte),
    capPrice: kCap, floorPrice: kFloor, stopLossPct: null,
    headline: `${a.symbol} locked between ${fmtUsd(kFloor)} and ${fmtUsd(kCap)} - the insurance is paid for by the cap (net ${net >= 0 ? "credit" : "cost"} ~${fmtUsd(Math.abs(net), 2)}/unit).`,
    tradeoffs: [
      `Can't fall below ${fmtUsd(kFloor)}; can't earn above ${fmtUsd(kCap)}. You trade tail upside for tail protection.`,
      "Near-zero net cost because the sold call funds the bought put.",
      "In a huge rally you will underperform holding - that's the price of the floor.",
    ],
    managed: [
      "Re-strikes the range each cycle around the new spot",
      "Suggests loosening the collar when IV is cheap",
    ],
  };
}

function bearQuote(a: Asset, o: Partial<IntentParams> = {}): Quote {
  const p = { ...DEF, ...o };
  const t = p.dte / 365;
  const kHi = roundStrike(a.spot * 0.98, a);
  const kLo = roundStrike(a.spot * 0.85, a);
  const cost = putPrice(a.spot, kHi, a.iv, t) - putPrice(a.spot, kLo, a.iv, t);
  const maxWin = kHi - kLo - cost;
  return {
    strategyId: "bear", assetSymbol: a.symbol, title: `Smart Short · ${a.symbol}`,
    legs: [
      { kind: "put", side: "long", strike: kHi, premium: putPrice(a.spot, kHi, a.iv, t), qty: 1 },
      { kind: "put", side: "short", strike: kLo, premium: putPrice(a.spot, kLo, a.iv, t), qty: 1 },
    ],
    assetQty: 0, dte: p.dte,
    incomeMonthly: -cost, incomeAnnualPct: 0, capPrice: null, floorPrice: null,
    stopLossPct: p.stopLossPct,
    headline: `Profit up to ${fmtUsd(maxWin, 2)}/unit if ${a.symbol} falls toward ${fmtUsd(kLo)} - risk strictly capped at ${fmtUsd(cost, 2)}.`,
    tradeoffs: [
      `Maximum loss is the ${fmtUsd(cost, 2)}/unit you pay - no liquidations, no unlimited short risk, ever.`,
      `Max profit ${fmtUsd(maxWin, 2)}/unit if price is at/below ${fmtUsd(kLo)} at expiry.`,
      `If ${a.symbol} rises or goes sideways, the position decays toward zero.`,
    ],
    managed: [
      "Takes profit automatically at 60% of max value",
      "Closes the spread if thesis invalidated (price above entry + stop%)",
    ],
  };
}

export const STRATEGIES: Strategy[] = [
  { id: "income", name: "Income Mode", emoji: "💰", proName: "covered call",
    tagline: "Earn yield on what you hold. Upside capped past your target.",
    fitsWhen: "You'd happily sell at a higher price anyway.",
    risk: "conservative", quote: incomeQuote },
  { id: "wheel", name: "The Wheel", emoji: "🎡", proName: "cash-secured put → covered call",
    tagline: "Get paid to buy dips, then paid again on the bag.",
    fitsWhen: "You want in cheaper and don't mind owning it.",
    risk: "moderate", quote: wheelQuote },
  { id: "shield", name: "Downside Shield", emoji: "🛡️", proName: "protective put",
    tagline: "A hard floor under your position. Costs premium.",
    fitsWhen: "You can't stomach a drawdown but won't sell.",
    risk: "conservative", quote: shieldQuote },
  { id: "collar", name: "Lock the Range", emoji: "🔒", proName: "collar",
    tagline: "Floor paid for by a ceiling. Near-zero cost.",
    fitsWhen: "Protect a big position without paying for insurance.",
    risk: "conservative", quote: collarQuote },
  { id: "bear", name: "Smart Short", emoji: "📉", proName: "put spread",
    tagline: "Bet on a fall with strictly capped risk. No liquidations.",
    fitsWhen: "You think it drops but won't risk a short squeeze.",
    risk: "spicy", quote: bearQuote },
];

export const strategy = (id: string) => STRATEGIES.find((s) => s.id === id)!;
