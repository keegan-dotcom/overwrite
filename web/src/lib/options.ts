/**
 * Black-Scholes utilities - TypeScript port of agent/strategy/greeks.py.
 * Powers the demo app's REAL strike/premium math: the intent engine solves
 * for strikes from user targets instead of showing canned numbers.
 */

const SQRT_2 = Math.sqrt(2);

function erf(x: number): number {
  // Abramowitz-Stegun 7.1.26
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return s * y;
}

export const normCdf = (x: number) => 0.5 * (1 + erf(x / SQRT_2));

export function invNormCdf(p: number): number {
  // Acklam's rational approximation
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

const d1 = (s: number, k: number, v: number, t: number) =>
  (Math.log(s / k) + 0.5 * v * v * t) / (v * Math.sqrt(t));

export function callPrice(s: number, k: number, v: number, t: number): number {
  if (t <= 0) return Math.max(0, s - k);
  const D1 = d1(s, k, v, t);
  return s * normCdf(D1) - k * normCdf(D1 - v * Math.sqrt(t));
}

export function putPrice(s: number, k: number, v: number, t: number): number {
  if (t <= 0) return Math.max(0, k - s);
  return callPrice(s, k, v, t) - s + k;
}

export const callDelta = (s: number, k: number, v: number, t: number) =>
  t <= 0 ? (s > k ? 1 : 0) : normCdf(d1(s, k, v, t));

export function strikeForDelta(s: number, delta: number, v: number, t: number): number {
  const z = invNormCdf(delta);
  return s * Math.exp(0.5 * v * v * t - z * v * Math.sqrt(t));
}

/** Annualized yield of premium collected each cycle on spot notional. */
export const annualYield = (premium: number, spot: number, dteDays: number) =>
  (premium / spot) * (365 / dteDays);

/** Solve the covered-call strike that produces a target annualized yield.
 * Returns null if unreachable even at-the-money. Bisection on strike. */
export function strikeForYield(
  s: number, targetAnnual: number, v: number, t: number
): number | null {
  const dte = t * 365;
  const atmY = annualYield(callPrice(s, s, v, t), s, dte);
  if (targetAnnual > atmY) return null; // can't reach even ATM
  let lo = s, hi = s * 3;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const y = annualYield(callPrice(s, mid, v, t), s, dte);
    if (y > targetAnnual) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export type Leg = {
  kind: "call" | "put";
  side: "long" | "short";
  strike: number;
  premium: number; // per unit, positive number
  qty: number;     // per unit of underlying
};

/** P&L at expiry per 1 unit of underlying, incl. `assetQty` of held asset. */
export function pnlAtExpiry(price: number, spot0: number, assetQty: number, legs: Leg[]): number {
  let pnl = assetQty * (price - spot0);
  for (const l of legs) {
    const intrinsic = l.kind === "call" ? Math.max(0, price - l.strike) : Math.max(0, l.strike - price);
    const sign = l.side === "short" ? -1 : 1;
    pnl += l.qty * (sign * intrinsic + (l.side === "short" ? l.premium : -l.premium));
  }
  return pnl;
}

export const fmtUsd = (x: number, dp = 0) =>
  x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: dp, minimumFractionDigits: 0 });
export const fmtPct = (x: number, dp = 1) => `${(x * 100).toFixed(dp)}%`;
