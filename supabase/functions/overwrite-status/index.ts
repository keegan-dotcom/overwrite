/** Hosted-pilot status: GET/POST {derive_wallet} → tenant + ledger + cycles,
 * plus LIVE venue data (positions, open orders, collateral) when the tenant
 * is active - the server holds the trading-scoped session key, so the web
 * Console can show the real account without any client-side signing.
 * Public read-only by design (testnet pilot). */
import { CORS, json, sb, decryptPk, authHeaders, rpc } from "../_shared/derive.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  let wallet = url.searchParams.get("wallet") ?? "";
  if (!wallet && req.method === "POST") {
    try { wallet = (await req.json())?.derive_wallet ?? ""; } catch { /* noop */ }
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return json({ error: "invalid wallet" }, 400);
  const db = sb();
  // accept either the Derive wallet or the owner EOA (what the site connects)
  const sel = "id,derive_wallet,status,subaccount_id,session_key_address,session_key_enc,config,last_cycle_at,last_error,kill,created_at";
  let { data: t } = await db.from("tenants").select(sel)
    .ilike("derive_wallet", wallet).maybeSingle();
  if (!t) {
    ({ data: t } = await db.from("tenants").select(sel)
      .ilike("owner_eoa", wallet).order("created_at", { ascending: false })
      .limit(1).maybeSingle());
  }
  if (!t) return json({ enrolled: false });
  wallet = t.derive_wallet; // auth headers must use the Derive wallet
  const { data: ledger } = await db.from("ledger")
    .select("ts,kind,instrument,usd").eq("tenant_id", t.id)
    .order("ts", { ascending: false }).limit(25);
  const { data: cycles } = await db.from("cycles")
    .select("ts,ok,msg").eq("tenant_id", t.id)
    .order("ts", { ascending: false }).limit(12);
  const premium = (ledger ?? []).filter((l) => l.kind === "premium_in")
    .reduce((a, b) => a + Number(b.usd ?? 0), 0);

  // live venue snapshot (best-effort - the Console degrades gracefully)
  let positions: unknown[] | undefined;
  let open_orders: unknown[] | undefined;
  let collaterals: unknown[] | undefined;
  let equity_usd: number | undefined;
  if (t.status === "active" && t.subaccount_id != null && t.session_key_enc) {
    try {
      const pk = await decryptPk(t.session_key_enc);
      const hdrs = await authHeaders(pk, wallet);
      const sub = await rpc("private/get_subaccount", { subaccount_id: t.subaccount_id }, hdrs);
      collaterals = (sub?.collaterals ?? []).map((c: any) => ({
        asset: c.asset_name, amount: Number(c.amount), value_usd: Number(c.mark_value ?? 0),
      }));
      equity_usd = Number(sub?.subaccount_value ?? 0);
      positions = (sub?.positions ?? [])
        .filter((p: any) => Math.abs(Number(p.amount)) > 1e-9)
        .map((p: any) => ({
          instrument: p.instrument_name,
          amount: Number(p.amount),
          mark: Number(p.mark_price ?? 0),
          avg_price: Number(p.average_price ?? 0),
          unrealized_pnl: Number(p.unrealized_pnl ?? 0),
          delta: Number(p.delta ?? 0),
        }));
      const oo = await rpc("private/get_open_orders", { subaccount_id: t.subaccount_id }, hdrs);
      open_orders = (oo?.orders ?? [])
        .map((o: any) => ({
          instrument: o.instrument_name,
          direction: o.direction,
          amount: Number(o.amount),
          filled: Number(o.filled_amount ?? 0),
          price: Number(o.limit_price ?? 0),
          label: o.label,
          ts: Number(o.creation_timestamp ?? 0),
        }));
    } catch { /* venue hiccup - return DB view only */ }
  }

  const { session_key_enc: _drop, id: _drop2, ...pub } = t as Record<string, unknown>;
  return json({
    enrolled: true, ...pub, premium_recent: premium, ledger, cycles,
    positions, open_orders, collaterals, equity_usd,
  });
});
