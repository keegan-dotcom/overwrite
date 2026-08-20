/**
 * Live spot/index prices from Derive's public API. The app shipped with
 * hardcoded demo prices in appdata.ts; that's fine for a static preview but
 * WRONG the moment the agent suggests real trades ("dip to $3,600" when ETH is
 * $2,300"). This fetches the real index price per asset and patches ASSETS in
 * place, so every downstream consumer (planner strikes, chat copy, the header
 * chip, Black-Scholes previews) uses the real number.
 *
 * Reads are public and not geo-blocked (only order placement is), so this works
 * from any browser. Falls back to the baked demo price if a fetch fails.
 */
import { ASSETS } from "../data/appdata";

const DERIVE_PUBLIC = "https://api.lyra.finance/public/get_ticker";

// assets with a live Derive perp we can read an index price from
const LIVE_SYMBOLS = ["BTC", "ETH", "HYPE"];

async function fetchIndex(symbol: string): Promise<number | null> {
  try {
    const r = await fetch(DERIVE_PUBLIC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instrument_name: `${symbol}-PERP` }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const px = Number(j?.result?.index_price ?? j?.index_price);
    return Number.isFinite(px) && px > 0 ? px : null;
  } catch {
    return null;
  }
}

/** Fetch live index prices and patch ASSETS[].spot in place. Returns the map of
 * symbols that were refreshed → their live price. Safe to call repeatedly. */
export async function refreshLivePrices(): Promise<Record<string, number>> {
  const updated: Record<string, number> = {};
  await Promise.all(
    LIVE_SYMBOLS.map(async (sym) => {
      const px = await fetchIndex(sym);
      if (px == null) return;
      const a = ASSETS.find((x) => x.symbol === sym);
      if (a) { a.spot = px; updated[sym] = px; }
    }),
  );
  return updated;
}
