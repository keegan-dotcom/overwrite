/** Live prices proxy. Returns Derive's real index price + best-effort ATM IV
 * per asset, fetched SERVER-SIDE so the browser never has to (no CORS risk,
 * never a stale demo price). Public, read-only, cached 20s. */
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "content-type": "application/json", "cache-control": "public, max-age=20" } });

const BASE = "https://api.lyra.finance";
const SYMS = ["BTC", "ETH", "HYPE"];

async function rpc(path: string, params: unknown): Promise<any> {
  const r = await fetch(`${BASE}/${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params ?? {}),
  });
  const j = await r.json();
  return j.result ?? j;
}

// best-effort ATM implied vol, ~30d, from the option ticker (fields vary)
async function atmIv(sym: string, spot: number): Promise<number | null> {
  try {
    const insts = await rpc("public/get_instruments", { currency: sym, expired: false, instrument_type: "option" });
    const nowS = Date.now() / 1000;
    const cands = (insts ?? []).filter((i: any) => {
      const d = i.option_details; if (!d) return false;
      const dte = (d.expiry - nowS) / 86400;
      return dte >= 15 && dte <= 45;
    });
    if (!cands.length) return null;
    cands.sort((a: any, b: any) =>
      Math.abs(Number(a.option_details.strike) - spot) - Math.abs(Number(b.option_details.strike) - spot));
    const t = await rpc("public/get_ticker", { instrument_name: cands[0].instrument_name });
    const iv = Number(
      t?.option_pricing?.iv ?? t?.option_pricing?.mark_iv ?? t?.mark_iv ?? t?.iv ?? t?.implied_volatility);
    return Number.isFinite(iv) && iv > 0 ? iv : null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const out: Record<string, { spot: number; iv: number | null }> = {};
  await Promise.all(SYMS.map(async (sym) => {
    try {
      const t = await rpc("public/get_ticker", { instrument_name: `${sym}-PERP` });
      const spot = Number(t?.index_price);
      if (!Number.isFinite(spot) || spot <= 0) return;
      out[sym] = { spot, iv: await atmIv(sym, spot) };
    } catch { /* skip this asset */ }
  }));
  return json({ assets: out, ts: Date.now() });
});
