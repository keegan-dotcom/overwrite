/**
 * Intent engine: natural-language prompt → structured trade.
 * This is the demo's brain - a deterministic parser that maps what a
 * beginner types ("earn 10% on my btc but I'd sell at 120k, bail if
 * down 20%") onto a strategy + IntentParams, which appdata.ts prices
 * live with Black-Scholes. In production this seat is held by an LLM
 * with the same structured output contract.
 */
import { ASSETS, Asset, IntentParams, DEMO_PORTFOLIO } from "../data/appdata";

export type ParsedIntent = {
  symbol: string;
  strategyId: string;
  params: Partial<IntentParams>;
  understood: string[]; // plain-english trace of what was parsed
};

const SYMBOL_WORDS: Record<string, string[]> = {
  BTC: ["btc", "bitcoin"],
  ETH: ["eth", "ethereum", "ether"],
  HYPE: ["hype", "hyperliquid"],
  SPX: ["spx", "s&p", "sp500", "s&p 500", "sp 500", "spy", "index"],
  NVDA: ["nvda", "nvidia"],
  AAPL: ["aapl", "apple"],
};

/** "$120k" | "120,000" | "4.2k" | "98000" → number */
function parseMoney(raw: string): number {
  const cleaned = raw.replace(/[$,\s]/g, "").toLowerCase();
  const mult = cleaned.endsWith("k") ? 1_000 : cleaned.endsWith("m") ? 1_000_000 : 1;
  return parseFloat(cleaned) * mult;
}

function detectAsset(text: string): string | null {
  for (const [sym, words] of Object.entries(SYMBOL_WORDS)) {
    for (const w of words) {
      if (text.includes(w)) return sym;
    }
  }
  return null;
}

function detectStrategy(text: string): string {
  const has = (...ws: string[]) => ws.some((w) => text.includes(w));
  if (has("collar", "lock the range", "range", "zero cost", "free insurance", "cost nothing", "pay for itself"))
    return "collar";
  if (has("protect", "hedge", "insurance", "floor", "crash", "shield", "downside", "can't lose", "cant lose", "stop the bleeding"))
    return "shield";
  if (has("short", "bet against", "goes down", "will fall", "will drop", "bearish", "puts on", "overvalued", "dump"))
    return "bear";
  if (has("buy the dip", "buy lower", "buy it cheaper", "accumulate", "wheel", "get in", "entry", "paid to buy", "paid to wait"))
    return "wheel";
  return "income"; // yield / earn / income / apy / default
}

export function parseIntent(text: string): ParsedIntent {
  const t = text.toLowerCase();
  const understood: string[] = [];

  // asset: explicit mention, else largest holding
  let symbol = detectAsset(t);
  if (symbol) {
    understood.push(`Asset: ${symbol}`);
  } else {
    const best = DEMO_PORTFOLIO.map((h) => {
      const a = ASSETS.find((x) => x.symbol === h.symbol)!;
      return { sym: h.symbol, usd: h.qty * a.spot };
    }).sort((x, y) => y.usd - x.usd)[0];
    symbol = best.sym;
    understood.push(`Asset: ${symbol} (your largest holding - say another name to switch)`);
  }
  const asset = ASSETS.find((a) => a.symbol === symbol)!;

  const strategyId = detectStrategy(t);
  const params: Partial<IntentParams> = {};

  // yield target: "10% yield", "earn 12%", "15% apy"
  const yieldMatch =
    t.match(/(\d+(?:\.\d+)?)\s*%\s*(?:a year|annual|apy|yield|income)?/g) || [];
  for (const m of yieldMatch) {
    const idx = t.indexOf(m);
    const around = t.slice(Math.max(0, idx - 30), idx + m.length + 12);
    const val = parseFloat(m) / 100;
    if (/down|drop|fall|lose|loss|stop|bail|exit|close/.test(around) &&
        !/yield|apy|income|earn/.test(around.slice(0, 30 + m.length))) {
      params.stopLossPct = val;
      understood.push(`Auto-close if position down ${(val * 100).toFixed(0)}%`);
    } else if (/yield|apy|income|earn|make|target|%\s*(a year|annual)/.test(around) || strategyId === "income") {
      params.targetYieldAnnual = val;
      understood.push(`Income target: ${(val * 100).toFixed(0)}%/yr`);
    }
  }

  // price target: "$120k", "past 120,000", "sell at 4500", "floor at 90k"
  const priceMatch = t.match(/\$\s?[\d,.]+\s?[km]?|\b\d{2,3},\d{3}\b|\b\d+(?:\.\d+)?\s?k\b/g) || [];
  for (const m of priceMatch) {
    const v = parseMoney(m);
    if (!isFinite(v) || v <= 0) continue;
    // plausibility: within 0.3x..4x of spot
    if (v > asset.spot * 0.3 && v < asset.spot * 4) {
      params.capTarget = v;
      understood.push(
        strategyId === "shield"
          ? `Floor target: $${v.toLocaleString()}`
          : `Upside kept until $${v.toLocaleString()}`
      );
      break;
    }
  }

  // horizon: "weekly", "monthly", "45 days", "2 months"
  const d = t.match(/(\d+)\s*(day|days|d\b)/);
  const mo = t.match(/(\d+)\s*(month|months|mo\b)/);
  if (t.includes("weekly") || t.includes("every week")) {
    params.dte = 7; understood.push("Cadence: weekly");
  } else if (d) {
    params.dte = Math.max(3, Math.min(120, parseInt(d[1], 10)));
    understood.push(`Horizon: ${params.dte} days`);
  } else if (mo) {
    params.dte = Math.max(7, Math.min(120, parseInt(mo[1], 10) * 30));
    understood.push(`Horizon: ~${params.dte} days`);
  }

  return { symbol, strategyId, params, understood };
}

/** Quick-start prompts shown as chips in the chat. */
export const SUGGESTED_PROMPTS = [
  "Earn 10% a year on my BTC - happy to sell above $120k. Close it if I'm down 20%.",
  "Protect my ETH from a crash but keep the upside",
  "Lock my HYPE in a range that costs nothing",
  "Get paid to buy the ETH dip",
  "Short HYPE with capped risk",
];

export function assetOf(sym: string): Asset {
  return ASSETS.find((a) => a.symbol === sym)!;
}
