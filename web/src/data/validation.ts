// Numbers from backtest/results/validation.json (Monte-Carlo, 2000 paths/cell,
// calibrated to live July-2026 IVs and the 40-year CBOE BXM/BXMD record).
// These are the SAME numbers quoted in docs/STRATEGY.md - keep in sync.

export type Underlying = {
  symbol: string;
  name: string;
  iv: number;               // IV30 used in validation
  live: boolean;            // tradable on Derive today
  // gross annualized premium yield by target delta (0.15 / 0.25 / 0.30)
  gross: { d15: number; d25: number; d30: number };
  // net edge vs buy-and-hold (base drift), 0.30 delta, percentage points
  netEdgeBase: number;
  // lag vs buy-and-hold in a +25% year (0.30 delta), percentage points
  bullCost: number;
};

export const UNDERLYINGS: Underlying[] = [
  { symbol: "ETH",  name: "Ethereum",  iv: 0.50,  live: true,  gross: { d15: 0.16, d25: 0.25, d30: 0.305 }, netEdgeBase: 5.8,  bullCost: 1.8 },
  { symbol: "BTC",  name: "Bitcoin",   iv: 0.38,  live: true,  gross: { d15: 0.12, d25: 0.19, d30: 0.233 }, netEdgeBase: 4.0,  bullCost: -0.5 },
  { symbol: "NVDA", name: "Nvidia",    iv: 0.445, live: false, gross: { d15: 0.14, d25: 0.22, d30: 0.272 }, netEdgeBase: 1.9,  bullCost: -2.9 },
  { symbol: "TSLA", name: "Tesla",     iv: 0.45,  live: false, gross: { d15: 0.14, d25: 0.22, d30: 0.273 }, netEdgeBase: 3.2,  bullCost: -1.5 },
  { symbol: "AAPL", name: "Apple",     iv: 0.22,  live: false, gross: { d15: 0.057, d25: 0.11, d30: 0.139 }, netEdgeBase: -0.6, bullCost: -5.4 },
  { symbol: "SPY",  name: "S&P 500",   iv: 0.165, live: false, gross: { d15: 0.043, d25: 0.085, d30: 0.107 }, netEdgeBase: 0.8,  bullCost: -4.4 },
];

export const DELTAS = [
  { key: "d15" as const, label: "0.15Δ", tag: "Conservative", capOdds: "~15% of cycles capped" },
  { key: "d25" as const, label: "0.25Δ", tag: "Standard",     capOdds: "~25% of cycles capped" },
  { key: "d30" as const, label: "0.30Δ", tag: "Aggressive",   capOdds: "~30% of cycles capped" },
];

export const pct = (x: number, dp = 1) => `${(x * 100).toFixed(dp)}%`;
export const pts = (x: number) =>
  `${x >= 0 ? "+" : ""}${x.toFixed(1)}pts`;
