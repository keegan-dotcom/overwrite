/**
 * The hosted fleet cycle - "hosted-lite" income engine, runs every 15 min
 * via pg_cron. v1 scope: covered calls only, post-only maker quotes,
 * coverage invariant, min-yield gate, order budget, trade-history sync.
 * The full python agent remains the reference engine; parity items
 * (take-profit buybacks, defensive rolls) land iteratively.
 *
 * Auth: shared-secret header set by the cron job (plus anon JWT).
 */
import {
  json, sb, decryptPk, authHeaders, rpc, actionNonce, encodeTrade, typedHash,
  callDelta, annYield, quantize,
} from "../_shared/derive.ts";
import { privateKeyToAccount } from "npm:viem@2/accounts";

const FLEET_SECRET = "c50a22ca7fe917ff486219134dbd502f9915ab9c074f7565";
const LABEL = "overwrite-hosted";
const MAX_UTIL = 0.9;

Deno.serve(async (req) => {
  if (req.headers.get("x-fleet-secret") !== FLEET_SECRET) return json({ error: "forbidden" }, 403);
  const db = sb();
  const { data: tenants } = await db.from("tenants")
    .select("*").eq("status", "active").eq("kill", false).limit(20);
  const results: Record<string, string> = {};
  for (const t of tenants ?? []) {
    try {
      const msg = await cycle(db, t);
      results[t.derive_wallet] = msg;
      await db.from("cycles").insert({ tenant_id: t.id, ok: true, msg });
      await db.from("tenants").update({
        last_cycle_at: new Date().toISOString(), last_error: null,
      }).eq("id", t.id);
    } catch (e) {
      const err = String(e).slice(0, 400);
      results[t.derive_wallet] = `ERROR ${err}`;
      await db.from("cycles").insert({ tenant_id: t.id, ok: false, msg: err });
      await db.from("tenants").update({ last_error: err }).eq("id", t.id);
    }
  }
  return json({ ran: (tenants ?? []).length, results });
});

async function cycle(db: any, t: any): Promise<string> {
  const cfg = t.config ?? {};
  const sym = cfg.symbol ?? "ETH";
  const pk = await decryptPk(t.session_key_enc);
  const signer = privateKeyToAccount(pk).address;
  const hdrs = await authHeaders(pk, t.derive_wallet);
  const subId = Number(t.subaccount_id);
  const notes: string[] = [];

  // portfolio state
  const sub = await rpc("private/get_subaccount", { subaccount_id: subId }, hdrs);
  const collaterals = sub?.collaterals ?? [];
  const base = collaterals.find((c: any) =>
    String(c.asset_name ?? c.currency ?? "").toUpperCase().includes(sym));
  const baseAmt = Math.abs(Number(base?.amount ?? 0));
  const positions = (sub?.positions ?? []).filter((p: any) =>
    String(p.instrument_name ?? "").startsWith(`${sym}-`) &&
    String(p.instrument_name ?? "").endsWith("-C") && Number(p.amount) < 0);
  const shortCalls = positions.reduce((a: number, p: any) => a + Math.abs(Number(p.amount)), 0);

  // trade-history sync → premium ledger
  try {
    const trades = await rpc("private/get_trade_history",
      { subaccount_id: subId, from_timestamp: Number(t.last_trade_sync_ms ?? 0) + 1 }, hdrs);
    for (const tr of trades?.trades ?? []) {
      if (String(tr.label ?? "") !== LABEL) continue;
      const usd = Number(tr.trade_amount ?? tr.amount ?? 0) * Number(tr.trade_price ?? tr.price ?? 0);
      await db.from("ledger").insert({
        tenant_id: t.id,
        kind: tr.direction === "sell" ? "premium_in" : "buyback_out",
        instrument: tr.instrument_name,
        usd: tr.direction === "sell" ? usd : -usd,
        detail: { trade_id: tr.trade_id ?? null },
      });
      notes.push(`${tr.direction === "sell" ? "premium" : "buyback"} $${usd.toFixed(0)}`);
    }
    await db.from("tenants").update({ last_trade_sync_ms: Date.now() }).eq("id", t.id);
  } catch { notes.push("trade-sync skipped"); }

  // order budget
  const { count: ordersToday } = await db.from("ledger")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", t.id).eq("kind", "quote_placed")
    .gte("ts", new Date(Date.now() - 86400_000).toISOString());
  if ((ordersToday ?? 0) >= (cfg.max_orders_per_day ?? 40)) {
    return `order budget reached (${ordersToday}/24h) · covered ${shortCalls}/${baseAmt}`;
  }

  // cancel our stale resting quotes, then re-quote at fresh mark
  try {
    await rpc("private/cancel_by_label", { subaccount_id: subId, label: LABEL }, hdrs);
  } catch { /* nothing to cancel or endpoint variant - proceed */ }

  const capacity = baseAmt * MAX_UTIL - shortCalls;
  if (capacity < (cfg.min_order ?? 0.1)) {
    return `fully covered (${shortCalls.toFixed(2)}/${baseAmt.toFixed(2)} ${sym}) · idle`;
  }

  // instrument selection: dte window, nearest target delta (BS w/ fallback IV)
  const instruments = await rpc("public/get_instruments",
    { currency: sym, expired: false, instrument_type: "option" }, {});
  const nowS = Date.now() / 1000;
  const calls = (instruments ?? []).filter((i: any) => {
    const d = i.option_details;
    if (!d || d.option_type !== "C") return false;
    const dte = (d.expiry - nowS) / 86400;
    return dte >= (cfg.dte_min ?? 25) && dte <= (cfg.dte_max ?? 60);
  });
  if (!calls.length) return `no calls in ${cfg.dte_min}-${cfg.dte_max}d window · idle`;

  const probe = await rpc("public/get_ticker", { instrument_name: calls[0].instrument_name }, {});
  const spot = Number(probe.index_price);
  const iv = Number(cfg.iv_fallback ?? 0.5);
  let best: any = null, bestErr = Infinity;
  for (const c of calls) {
    const d = c.option_details;
    const delta = callDelta(spot, Number(d.strike), iv, (d.expiry - nowS) / 86400 / 365);
    const err = Math.abs(delta - (cfg.delta_target ?? 0.25));
    if (err < bestErr) { bestErr = err; best = c; }
  }
  const tick = await rpc("public/get_ticker", { instrument_name: best.instrument_name }, {});
  const mark = Number(tick.mark_price);
  const dte = (best.option_details.expiry - nowS) / 86400;
  const yld = annYield(mark, spot, dte);
  if (yld < (cfg.min_yield ?? 0.05)) {
    return `best ${best.instrument_name} yields ${(yld * 100).toFixed(1)}% < floor · idle`;
  }

  const amount = quantize(Math.min(capacity, cfg.max_order ?? 5), best.amount_step ?? "0.1");
  if (Number(amount) <= 0) return "capacity below amount step · idle";
  const price = quantize(Math.max(mark, Number(tick.best_ask_price) || mark), best.tick_size ?? "0.1");

  const nonce = actionNonce();
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const account = privateKeyToAccount(pk);
  const signature = await account.sign({
    hash: typedHash({
      subaccountId: subId, nonce,
      moduleDataEncoded: encodeTrade({
        assetAddress: best.base_asset_address, subId: BigInt(best.base_asset_sub_id),
        limitPrice: price, amount, maxFee: "1000", recipientId: subId, isBid: false,
      }),
      signatureExpirySec: expiry, owner: t.derive_wallet, signer,
    }),
  });
  await rpc("private/order", {
    instrument_name: best.instrument_name, direction: "sell", order_type: "limit",
    time_in_force: "post_only", amount, limit_price: price, max_fee: "1000",
    subaccount_id: subId, nonce: "__nonce__", signature,
    signature_expiry_sec: expiry, signer, mmp: false, reduce_only: false, label: LABEL,
  }, hdrs, nonce);
  await db.from("ledger").insert({
    tenant_id: t.id, kind: "quote_placed", instrument: best.instrument_name,
    usd: Number(price) * Number(amount),
    detail: { price, amount, delta_err: bestErr.toFixed(3), yld: yld.toFixed(3) },
  });
  return `quoted SELL ${amount} ${best.instrument_name} @ ${price} (${(yld * 100).toFixed(1)}% ann) ${notes.join(" · ")}`;
}
