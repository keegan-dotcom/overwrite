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
  callDelta, annYield, quantize, ENV,
} from "../_shared/derive.ts";
import { privateKeyToAccount } from "npm:viem@2/accounts";

const LABEL = "overwrite-hosted";
const MAX_UTIL = 0.9;

/** MAINNET SAFETY GATE: on prod, a tenant trades ONLY if its config sets
 * live:true - the explicit switch the account owner flips after reviewing
 * dry-run cycles. On testnet the fleet trades unless live:false. */
const isLive = (cfg: any): boolean =>
  ENV === "prod" ? cfg?.live === true : cfg?.live !== false;

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const db = sb();
  // shared secret lives ONLY in the deny-all fleet_config table (never in
  // code or the repo); the cron job reads the same row at fire time
  const { data: cfgRow } = await db.from("fleet_config")
    .select("value").eq("key", "fleet_secret").single();
  const expected = cfgRow?.value ?? "";
  const got = req.headers.get("x-fleet-secret") ?? "";
  if (!expected || !timingSafeEq(got, expected)) return json({ error: "forbidden" }, 403);
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
  return json({ ran: (tenants ?? []).length, env: ENV, results });
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
      const isOpt = String(tr.instrument_name ?? "").split("-").length >= 4;
      await db.from("ledger").insert({
        tenant_id: t.id,
        kind: isOpt ? (tr.direction === "sell" ? "premium_in" : "buyback_out") : "sweep_fill",
        instrument: tr.instrument_name,
        usd: tr.direction === "sell" ? usd : -usd,
        detail: { trade_id: tr.trade_id ?? null },
      });
      notes.push(`${isOpt ? (tr.direction === "sell" ? "premium" : "buyback") : "sweep fill"} $${Math.abs(usd).toFixed(0)}`);
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

  // premium sweep: route idle USDC (above a float you keep) into a spot buy
  // of the sweep target - e.g. XAUT call premium accumulating into BTC.
  // Runs before quoting so a filled call's premium converts within one cycle.
  if (cfg.sweep?.buy) {
    try {
      const swept = await sweep(db, t, cfg, hdrs, subId, collaterals);
      if (swept) notes.push(swept);
    } catch (e) { notes.push(`sweep skipped: ${String(e).slice(0, 120)}`); }
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
  // post-only sell: the price must sit ABOVE the best bid or the venue
  // rejects it (11008 "cannot cross the market"). Quote at the better of
  // mark/ask, then bump one tick past the bid if the book has crossed up.
  const tickSz = best.tick_size ?? "0.1";
  const bid = Number(tick.best_bid_price) || 0;
  let px = Number(quantize(Math.max(mark, Number(tick.best_ask_price) || mark), tickSz));
  if (px <= bid) px = bid + Number(tickSz);
  const dp = (tickSz.split(".")[1] ?? "").length;
  const price = px.toFixed(dp);

  // dormant mode: compute and log the exact order, place nothing. On
  // mainnet this is the default until the owner sets config.live = true.
  if (!isLive(cfg)) {
    return `DRY (live:false) - would quote SELL ${amount} ${best.instrument_name} @ ${price} (${(yld * 100).toFixed(1)}% ann) ${notes.join(" · ")}`;
  }

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
  try {
    await rpc("private/order", {
      instrument_name: best.instrument_name, direction: "sell", order_type: "limit",
      time_in_force: "post_only", amount, limit_price: price, max_fee: "1000",
      subaccount_id: subId, nonce: "__nonce__", signature,
      signature_expiry_sec: expiry, signer, mmp: false, reduce_only: false, label: LABEL,
    }, hdrs, nonce);
  } catch (e) {
    // 11008 = the book moved between pricing and placement; post-only
    // protection kicked in. Benign - we re-quote next cycle at fresh prices.
    if (String(e).includes("cannot cross")) {
      return `book moved at quote time - post-only protection skipped this cycle (re-quotes in 15m) ${notes.join(" · ")}`;
    }
    throw e;
  }
  await db.from("ledger").insert({
    tenant_id: t.id, kind: "quote_placed", instrument: best.instrument_name,
    usd: Number(price) * Number(amount),
    detail: { price, amount, delta_err: bestErr.toFixed(3), yld: yld.toFixed(3) },
  });
  return `quoted SELL ${amount} ${best.instrument_name} @ ${price} (${(yld * 100).toFixed(1)}% ann) ${notes.join(" · ")}`;
}

/**
 * Premium router: buy `cfg.sweep.buy` (e.g. BTC) spot with idle USDC above
 * the float. Marketable limit, IOC - fills immediately or not at all, never
 * rests. Hard-capped per cycle by max_sweep_usd. Honors the live flag.
 * config.sweep: { buy, keep_usdc_float?=100, min_sweep_usd?=25, max_sweep_usd?=250 }
 */
async function sweep(
  db: any, t: any, cfg: any, hdrs: Record<string, string>,
  subId: number, collaterals: any[],
): Promise<string | null> {
  const s = cfg.sweep;
  const usdc = Number(collaterals.find((c: any) =>
    String(c.asset_name ?? c.currency ?? "").toUpperCase() === "USDC")?.amount ?? 0);
  const float = Number(s.keep_usdc_float ?? 100);
  const minSweep = Number(s.min_sweep_usd ?? 25);
  const avail = usdc - float;
  if (avail < minSweep) return null;
  const budget = Math.min(avail, Number(s.max_sweep_usd ?? 250));

  const instName = `${String(s.buy).toUpperCase()}-USDC`;
  const inst = await rpc("public/get_instrument", { instrument_name: instName }, {});
  if (!inst?.base_asset_address) return `sweep: ${instName} not found`;
  const tick = await rpc("public/get_ticker", { instrument_name: instName }, {});
  const ask = Number(tick.best_ask_price) || Number(tick.mark_price) || 0;
  if (!(ask > 0)) return `sweep: no ask on ${instName}`;

  const amount = quantize(budget / ask, inst.amount_step ?? "0.0001");
  if (Number(amount) <= 0) return "sweep: budget below amount step";
  // marketable limit: a hair through the ask so IOC fills; floor-quantize
  // then bump a tick if that dropped us below the ask
  const tickSz = inst.tick_size ?? "0.01";
  let px = Number(quantize(ask * 1.002, tickSz));
  if (px < ask) px = px + Number(tickSz);
  const dp = (tickSz.split(".")[1] ?? "").length;
  const price = px.toFixed(dp);

  if (!isLive(cfg)) {
    return `DRY sweep - would BUY ${amount} ${instName} @ ≤${price} (~$${(Number(amount) * ask).toFixed(0)})`;
  }

  const nonce = actionNonce();
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const pk = await decryptPk(t.session_key_enc);
  const account = privateKeyToAccount(pk);
  const signature = await account.sign({
    hash: typedHash({
      subaccountId: subId, nonce,
      moduleDataEncoded: encodeTrade({
        assetAddress: inst.base_asset_address, subId: BigInt(inst.base_asset_sub_id ?? 0),
        limitPrice: price, amount, maxFee: "1000", recipientId: subId, isBid: true,
      }),
      signatureExpirySec: expiry, owner: t.derive_wallet, signer: account.address,
    }),
  });
  await rpc("private/order", {
    instrument_name: instName, direction: "buy", order_type: "limit",
    time_in_force: "ioc", amount, limit_price: price, max_fee: "1000",
    subaccount_id: subId, nonce: "__nonce__", signature,
    signature_expiry_sec: expiry, signer: account.address,
    mmp: false, reduce_only: false, label: LABEL,
  }, hdrs, nonce);
  await db.from("ledger").insert({
    tenant_id: t.id, kind: "sweep_buy", instrument: instName,
    usd: -(Number(price) * Number(amount)),
    detail: { price, amount, budget: budget.toFixed(2) },
  });
  return `swept ~$${(Number(amount) * ask).toFixed(0)} USDC → ${amount} ${String(s.buy).toUpperCase()}`;
}
