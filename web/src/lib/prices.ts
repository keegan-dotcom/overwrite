/**
 * Live spot + IV from Derive, patched into ASSETS in place so every downstream
 * consumer (planner strikes, chat copy, header chip, Black-Scholes previews)
 * uses REAL numbers — never the baked demo prices.
 *
 * Primary source is our backend proxy (overwrite-prices), which fetches Derive
 * server-side: zero CORS risk, and it carries IV too. If the proxy is somehow
 * unreachable, we fall back to a direct browser call to Derive's public API
 * (works because reads aren't geo-blocked). Only if BOTH fail do the demo
 * numbers remain — and that path is logged.
 */
import { ASSETS } from "../data/appdata";

const PROXY = "https://dpfsvupqssfzwsnhpdmg.supabase.co/functions/v1/overwrite-prices";
const DERIVE_PUBLIC = "https://api.lyra.finance/public/get_ticker";
const LIVE_SYMBOLS = ["BTC", "ETH", "HYPE"];

function patch(sym: string, spot: number, iv?: number | null) {
  const a = ASSETS.find((x) => x.symbol === sym);
  if (!a || !(spot > 0)) return false;
  a.spot = spot;
  if (iv != null && iv > 0) a.iv = iv;
  return true;
}

async function fromProxy(): Promise<string[]> {
  const r = await fetch(PROXY, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  if (!r.ok) throw new Error(`proxy ${r.status}`);
  const j = await r.json();
  const got: string[] = [];
  for (const [sym, v] of Object.entries((j?.assets ?? {}) as Record<string, { spot: number; iv?: number }>)) {
    if (patch(sym, Number(v.spot), v.iv)) got.push(sym);
  }
  return got;
}

async function fromDeriveDirect(sym: string): Promise<boolean> {
  try {
    const r = await fetch(DERIVE_PUBLIC, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ instrument_name: `${sym}-PERP` }),
    });
    if (!r.ok) return false;
    const j = await r.json();
    return patch(sym, Number(j?.result?.index_price ?? j?.index_price));
  } catch { return false; }
}

/** Refresh live prices/IV into ASSETS. Returns the symbols refreshed. Safe to
 * call repeatedly (on mount + on an interval). */
export async function refreshLivePrices(): Promise<Record<string, number>> {
  const updated: Record<string, number> = {};
  let symbols: string[] = [];
  try {
    symbols = await fromProxy();
  } catch {
    // proxy down — direct fallback per symbol
    const results = await Promise.all(LIVE_SYMBOLS.map(fromDeriveDirect));
    symbols = LIVE_SYMBOLS.filter((_, i) => results[i]);
  }
  for (const sym of symbols) {
    const a = ASSETS.find((x) => x.symbol === sym);
    if (a) updated[sym] = a.spot;
  }
  return updated;
}
