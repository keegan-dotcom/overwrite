/** Hosted-pilot status: GET/POST {derive_wallet} → tenant + ledger + cycles,
 * plus LIVE venue data (positions, open orders, collateral) when the tenant
 * is active - the server holds the trading-scoped session key, so the web
 * Console can show the real account without any client-side signing.
 *
 * Testnet: public read-only by design (fake money).
 * MAINNET: real-money positions are NOT public. A read must carry an owner
 * wallet signature (personal_sign of a canonical, timestamped message). The
 * server recovers the signer and returns data ONLY if the signer is the
 * account owner (tenant.owner_eoa). One signature is reused client-side for
 * a freshness window, so polling doesn't re-prompt. */
import { CORS, json, sb, decryptPk, authHeaders, rpc, ENV } from "../_shared/derive.ts";
import { recoverMessageAddress } from "npm:viem@2";

const READ_WINDOW_MS = 30 * 60_000; // signature freshness

// canonical read-auth message - MUST match the client (lib/hosted.ts) exactly
const readMessage = (owner: string, ts: number) =>
  `Overwrite mainnet read\nowner: ${owner}\nts: ${ts}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  // parse the body once (POST is the only path the app uses on mainnet)
  let body: any = {};
  if (req.method === "POST") { try { body = await req.json(); } catch { /* noop */ } }
  let wallet = url.searchParams.get("wallet") ?? body?.derive_wallet ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return json({ error: "invalid wallet" }, 400);

  // MAINNET read-gate: recover the signer from the read-auth signature and
  // require it to equal this account's owner. Verified against the resolved
  // tenant below (a valid signature for wallet A cannot read wallet B).
  let readOwner = "";
  if (ENV === "prod") {
    const ts = Number(body?.read_ts ?? 0);
    const sig = String(body?.read_sig ?? "");
    const owner = String(body?.owner ?? "");
    if (!/^0x[0-9a-fA-F]{40}$/.test(owner) || !/^0x[0-9a-fA-F]+$/.test(sig)) {
      return json({ error: "read_auth_required" }, 401);
    }
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > READ_WINDOW_MS) {
      return json({ error: "read_auth_expired" }, 401);
    }
    try {
      const rec = await recoverMessageAddress({
        message: readMessage(owner, ts), signature: sig as `0x${string}`,
      });
      if (rec.toLowerCase() !== owner.toLowerCase()) return json({ error: "bad_read_signature" }, 401);
    } catch { return json({ error: "bad_read_signature" }, 401); }
    readOwner = owner.toLowerCase();
  }
  const db = sb();
  // accept either the Derive wallet or the owner EOA (what the site connects)
  const sel = "id,derive_wallet,owner_eoa,status,subaccount_id,session_key_address,session_key_enc,config,last_cycle_at,last_error,kill,created_at";
  let { data: t } = await db.from("tenants").select(sel)
    .ilike("derive_wallet", wallet).maybeSingle();
  if (!t) {
    // owner-EOA lookup: prefer the ACTIVE tenant, else the oldest, so a
    // spam enrollment against someone's EOA can never shadow their account
    const { data: rows } = await db.from("tenants").select(sel)
      .ilike("owner_eoa", wallet).order("created_at", { ascending: true }).limit(10);
    t = (rows ?? []).find((r) => r.status === "active") ?? (rows ?? [])[0] ?? null;
  }
  if (!t) return json({ enrolled: false });
  // MAINNET: the verified signer must own this tenant, else reveal nothing
  // (a valid read-auth for your own wallet can't read anyone else's).
  if (ENV === "prod" && String(t.owner_eoa ?? "").toLowerCase() !== readOwner) {
    return json({ enrolled: false });
  }
  wallet = t.derive_wallet; // auth headers must use the Derive wallet
  const { data: ledger } = await db.from("ledger")
    .select("ts,kind,instrument,usd").eq("tenant_id", t.id)
    .order("ts", { ascending: false }).limit(25);
  const { data: cycles } = await db.from("cycles")
    .select("ts,ok,msg").eq("tenant_id", t.id)
    .order("ts", { ascending: false }).limit(12);
  // premium over the last 30 days, queried directly so a burst of
  // quote_placed rows can never push fills out of the window
  const { data: premRows } = await db.from("ledger")
    .select("usd").eq("tenant_id", t.id).eq("kind", "premium_in")
    .gte("ts", new Date(Date.now() - 30 * 86400_000).toISOString());
  const premium = (premRows ?? []).reduce((a, b) => a + Number(b.usd ?? 0), 0);

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
    enrolled: true, env: ENV, ...pub, premium_recent: premium, ledger, cycles,
    positions, open_orders, collaterals, equity_usd,
  });
});
