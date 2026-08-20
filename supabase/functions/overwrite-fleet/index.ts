/**
 * The hosted fleet cycle - private single-tenant instance (EU region).
 *
 * Two execution paths:
 *   1. LEGACY (unchanged): covered calls + optional premium sweep. Runs when a
 *      tenant has no `config.plan`. This is the path the live tenant uses -
 *      left byte-for-byte identical so nothing about it changes.
 *   2. IR PLAN (additive, P1+): when `config.plan` is a StrategyPlan, the plan
 *      is validated (coherence layer) and executed leg-by-leg: covered calls,
 *      protective puts, cash-secured puts (wheel), collars, spot buys/sells,
 *      perps + DCA (P3). Same isLive dry-run gate: on prod it only places real
 *      orders when config.live === true.
 *
 * Runs every 15 min. Auth: shared secret header set by the cron job.
 */
import {
  json, sb, decryptPk, authHeaders, rpc, actionNonce, encodeTrade, typedHash,
  callDelta, annYield, quantize, ENV,
} from "../_shared/derive.ts";
import { validatePlan, type StrategyPlan, type Leg, type Capabilities } from "../_shared/strategy.ts";
import {
  chooseOption, resolveAmount, coverageCap, priceLeg, dcaDue,
  type OptCand, type AccountView,
} from "../_shared/plan_exec.ts";
import { privateKeyToAccount } from "npm:viem@2/accounts";

const LABEL = "overwrite-hosted";
const MAX_UTIL = 0.9;
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
  // NEW: if this tenant runs a structured IR plan, execute that and return.
  // Otherwise fall through to the untouched legacy covered-call path.
  if (cfg.plan && typeof cfg.plan === "object") {
    return await runPlan(db, t, cfg);
  }

  const sym = cfg.symbol ?? "ETH";
  const pk = await decryptPk(t.session_key_enc);
  const signer = privateKeyToAccount(pk).address;
  const hdrs = await authHeaders(pk, t.derive_wallet);
  const subId = Number(t.subaccount_id);
  const notes: string[] = [];

  const sub = await rpc("private/get_subaccount", { subaccount_id: subId }, hdrs);
  const collaterals = sub?.collaterals ?? [];
  const base = collaterals.find((c: any) =>
    String(c.asset_name ?? c.currency ?? "").toUpperCase().includes(sym));
  const baseAmt = Math.abs(Number(base?.amount ?? 0));
  const positions = (sub?.positions ?? []).filter((p: any) =>
    String(p.instrument_name ?? "").startsWith(`${sym}-`) &&
    String(p.instrument_name ?? "").endsWith("-C") && Number(p.amount) < 0);
  const shortCalls = positions.reduce((a: number, p: any) => a + Math.abs(Number(p.amount)), 0);

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

  const { count: ordersToday } = await db.from("ledger")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", t.id).eq("kind", "quote_placed")
    .gte("ts", new Date(Date.now() - 86400_000).toISOString());
  if ((ordersToday ?? 0) >= (cfg.max_orders_per_day ?? 40)) {
    return `order budget reached (${ordersToday}/24h) · covered ${shortCalls}/${baseAmt}`;
  }

  if (cfg.sweep?.buy) {
    try {
      const swept = await sweep(db, t, cfg, hdrs, subId, collaterals);
      if (swept) notes.push(swept);
    } catch (e) { notes.push(`sweep skipped: ${String(e).slice(0, 120)}`); }
  }

  try {
    await rpc("private/cancel_by_label", { subaccount_id: subId, label: LABEL }, hdrs);
  } catch { /* nothing to cancel - proceed */ }

  const capacity = baseAmt * MAX_UTIL - shortCalls;
  if (capacity < (cfg.min_order ?? 0.1)) {
    return `fully covered (${shortCalls.toFixed(2)}/${baseAmt.toFixed(2)} ${sym}) · idle · ${notes.join(" · ")}`;
  }

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
    return `best ${best.instrument_name} yields ${(yld * 100).toFixed(1)}% < floor · idle · ${notes.join(" · ")}`;
  }

  const amount = quantize(Math.min(capacity, cfg.max_order ?? 5), best.amount_step ?? "0.1");
  if (Number(amount) <= 0) return "capacity below amount step · idle";
  const tickSz = best.tick_size ?? "0.1";
  const bid = Number(tick.best_bid_price) || 0;
  let px = Number(quantize(Math.max(mark, Number(tick.best_ask_price) || mark), tickSz));
  if (px <= bid) px = bid + Number(tickSz);
  const dp = (tickSz.split(".")[1] ?? "").length;
  const price = px.toFixed(dp);

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

/* ========================================================================== *
 *  IR PLAN EXECUTOR (P1: options + spot · P3 adds perps + DCA scheduling)
 * ========================================================================== */

type Ctx = {
  pk: `0x${string}`;
  signer: string;
  hdrs: Record<string, string>;
  subId: number;
  collaterals: any[];
  positions: any[];
  spot: Record<string, number>;   // index price per asset
  equity: number;                 // subaccount_value (USD)
  maintMargin: number;            // maintenance_margin (USD, ≥0)
};

/** Held amount of an asset in the subaccount collateral (base units). */
function held(ctx: Ctx, asset: string): number {
  return ctx.collaterals
    .filter((c: any) => String(c.asset_name ?? c.currency ?? "").toUpperCase() === asset.toUpperCase())
    .reduce((a: number, c: any) => a + Math.abs(Number(c.amount ?? 0)), 0);
}
function usdcFree(ctx: Ctx): number {
  return Number(ctx.collaterals.find((c: any) =>
    String(c.asset_name ?? c.currency ?? "").toUpperCase() === "USDC")?.amount ?? 0);
}

/** Signed size of existing short options of a given type on an asset. */
function shortOptionAmount(ctx: Ctx, asset: string, type: "C" | "P"): number {
  return (ctx.positions ?? [])
    .filter((p: any) => String(p.instrument_name ?? "").startsWith(`${asset.toUpperCase()}-`) &&
      String(p.instrument_name ?? "").endsWith(`-${type}`) && Number(p.amount) < 0)
    .reduce((a: number, p: any) => a + Math.abs(Number(p.amount)), 0);
}

async function indexPrice(asset: string, cache: Record<string, number>): Promise<number> {
  const key = asset.toUpperCase();
  if (cache[key]) return cache[key];
  // any instrument on the asset carries index_price; use the perp or an option probe
  try {
    const t = await rpc("public/get_ticker", { instrument_name: `${key}-PERP` }, {});
    const p = Number(t.index_price);
    if (p > 0) { cache[key] = p; return p; }
  } catch { /* no perp - fall through */ }
  const insts = await rpc("public/get_instruments",
    { currency: key, expired: false, instrument_type: "option" }, {});
  if ((insts ?? []).length) {
    const t = await rpc("public/get_ticker", { instrument_name: insts[0].instrument_name }, {});
    const p = Number(t.index_price);
    if (p > 0) { cache[key] = p; return p; }
  }
  throw new Error(`no index price for ${key}`);
}

/** Fetch + filter option candidates (type + DTE window), then pick via the
 * pure chooser. */
async function selectOption(leg: Leg, spotPx: number): Promise<any> {
  const spec = leg.option!;
  const nowS = Date.now() / 1000;
  const insts = await rpc("public/get_instruments",
    { currency: leg.asset.toUpperCase(), expired: false, instrument_type: "option" }, {});
  const cands = ((insts ?? []) as OptCand[]).filter((i: any) => {
    const d = i.option_details;
    if (!d || d.option_type !== spec.type) return false;
    const dte = (d.expiry - nowS) / 86400;
    return dte >= spec.expiry.dteMin && dte <= spec.expiry.dteMax;
  });
  if (!cands.length) throw new Error(`no ${spec.type} in ${spec.expiry.dteMin}-${spec.expiry.dteMax}d`);
  const best = chooseOption(cands, leg, spotPx, nowS);
  if (!best) throw new Error(`no ${spec.type} strike match`);
  return best;
}

/** AccountView adapter over the live Ctx for the pure sizing helpers. */
function acctView(ctx: Ctx): AccountView {
  return { held: (a: string) => held(ctx, a), spot: ctx.spot };
}

/** Place (or dry-log) one order for a resolved leg. */
async function placeLeg(
  db: any, t: any, cfg: any, ctx: Ctx, leg: Leg,
  inst: any, isBid: boolean, priceStr: string, amountStr: string, tif: string,
): Promise<void> {
  if (!isLive(cfg)) return; // dry-run: caller logs the intended order
  const nonce = actionNonce();
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const account = privateKeyToAccount(ctx.pk);
  const signature = await account.sign({
    hash: typedHash({
      subaccountId: ctx.subId, nonce,
      moduleDataEncoded: encodeTrade({
        assetAddress: inst.base_asset_address, subId: BigInt(inst.base_asset_sub_id ?? 0),
        limitPrice: priceStr, amount: amountStr, maxFee: "1000", recipientId: ctx.subId, isBid,
      }),
      signatureExpirySec: expiry, owner: t.derive_wallet, signer: account.address,
    }),
  });
  await rpc("private/order", {
    instrument_name: inst.instrument_name, direction: isBid ? "buy" : "sell",
    order_type: "limit", time_in_force: tif, amount: amountStr, limit_price: priceStr,
    max_fee: "1000", subaccount_id: ctx.subId, nonce: "__nonce__", signature,
    signature_expiry_sec: expiry, signer: account.address, mmp: false,
    reduce_only: !!leg.reduceOnly, label: LABEL,
  }, ctx.hdrs, nonce);
}

/** Execute one leg; returns a human note. Honors the dry-run gate. */
async function execLeg(db: any, t: any, cfg: any, plan: StrategyPlan, leg: Leg, ctx: Ctx): Promise<string> {
  const isBid = leg.side === "buy";
  const maker = leg.orderType === "post_only";

  // resolve the instrument + a reference price
  let inst: any, tick: any, refMark: number, tickSz: string, amtStep: string;
  if (leg.venue === "option") {
    const spotPx = await indexPrice(leg.asset, ctx.spot);
    inst = await selectOption(leg, spotPx);
    tick = await rpc("public/get_ticker", { instrument_name: inst.instrument_name }, {});
    refMark = Number(tick.mark_price);
    tickSz = inst.tick_size ?? "0.1";
    amtStep = inst.amount_step ?? "0.1";
  } else if (leg.venue === "spot") {
    const instName = `${leg.asset.toUpperCase()}-USDC`;
    inst = await rpc("public/get_instrument", { instrument_name: instName }, {});
    if (!inst?.base_asset_address) throw new Error(`${instName} not found`);
    tick = await rpc("public/get_ticker", { instrument_name: instName }, {});
    refMark = Number(tick.mark_price) || Number(tick.best_ask_price) || 0;
    tickSz = inst.tick_size ?? "0.01";
    amtStep = inst.amount_step ?? "0.0001";
  } else {
    // perp
    const instName = `${leg.asset.toUpperCase()}-PERP`;
    inst = await rpc("public/get_instrument", { instrument_name: instName }, {});
    if (!inst?.base_asset_address) throw new Error(`${instName} not found`);
    tick = await rpc("public/get_ticker", { instrument_name: instName }, {});
    refMark = Number(tick.mark_price) || Number(tick.index_price) || 0;
    tickSz = inst.tick_size ?? "0.1";
    amtStep = inst.amount_step ?? "0.001";
  }

  // resolve size (pure helper), then cap a covered short call to held base
  let amt = resolveAmount(leg, plan, acctView(ctx), refMark);
  if (leg.venue === "option" && leg.option?.type === "C" && leg.side === "sell"
      && (plan.objective.kind === "income" || plan.objective.kind === "collar" || leg.sizing.kind === "pct_of_collateral")) {
    amt = Math.min(amt, coverageCap(held(ctx, leg.asset), shortOptionAmount(ctx, leg.asset, "C"), MAX_UTIL));
  }
  // P3 guardrail: perps carry liquidation risk. Cap notional and require a
  // free-margin buffer so a perp leg can never over-lever the account.
  if (leg.venue === "perp" && refMark > 0) {
    const maxNotional = Number(plan.constraints.maxNotionalUsd ?? cfg.max_perp_notional_usd ?? Infinity);
    if (isFinite(maxNotional)) amt = Math.min(amt, maxNotional / refMark);
  }
  const amount = quantize(Math.max(0, amt), amtStep);
  if (Number(amount) <= 0) return `${leg.id}: size ≤ step · skip`;
  if (leg.venue === "perp" && refMark > 0) {
    const notional = Number(amount) * refMark;
    const freeMargin = ctx.equity - ctx.maintMargin;
    const needed = notional * Number(cfg.perp_initial_margin_frac ?? 0.2); // ~5x cap
    if (freeMargin < needed) {
      return `${leg.id}: margin buffer too thin (free $${freeMargin.toFixed(0)} < ~$${needed.toFixed(0)} for $${notional.toFixed(0)} notional) · skip`;
    }
  }

  // price (pure helper)
  const bid = Number(tick.best_bid_price) || 0;
  const ask = Number(tick.best_ask_price) || refMark || 0;
  const dp = (tickSz.split(".")[1] ?? "").length;
  const priced = priceLeg({ maker, isBid, refMark, bid, ask, tickSz: Number(tickSz) });
  const px = priced.px;
  const tif = priced.tif;
  if (!(px > 0)) return `${leg.id}: no price · skip`;
  const price = px.toFixed(dp);

  // income min-yield gate (only for premium-selling call legs)
  if (leg.venue === "option" && leg.side === "sell" && plan.objective.kind === "income") {
    const spotPx = ctx.spot[leg.asset.toUpperCase()] ?? refMark;
    const dte = (inst.option_details.expiry - Date.now() / 1000) / 86400;
    const yld = annYield(refMark, spotPx, dte);
    const floor = Number(cfg.min_yield ?? plan.objective.targetYieldAnnual ?? 0.05);
    if (yld < floor) return `${leg.id}: ${(yld * 100).toFixed(1)}% < ${(floor * 100).toFixed(0)}% floor · skip`;
  }

  const verb = isBid ? "BUY" : "SELL";
  if (!isLive(cfg)) {
    return `DRY ${leg.id}: ${verb} ${amount} ${inst.instrument_name} @ ${price} (${tif})`;
  }
  try {
    await placeLeg(db, t, cfg, ctx, leg, inst, isBid, price, amount, tif);
  } catch (e) {
    if (String(e).includes("cannot cross")) return `${leg.id}: book moved (post-only) · re-quotes next cycle`;
    throw e;
  }
  await db.from("ledger").insert({
    tenant_id: t.id,
    kind: leg.side === "sell" && leg.venue === "option" ? "quote_placed" : "leg_placed",
    instrument: inst.instrument_name,
    usd: (isBid ? -1 : 1) * Number(price) * Number(amount),
    detail: { leg: leg.id, venue: leg.venue, price, amount, tif },
  });
  return `${verb} ${amount} ${inst.instrument_name} @ ${price} (${tif})`;
}

/** Run a structured StrategyPlan for a tenant. */
async function runPlan(db: any, t: any, cfg: any): Promise<string> {
  const plan: StrategyPlan = cfg.plan;
  const pk = await decryptPk(t.session_key_enc);
  const signer = privateKeyToAccount(pk).address;
  const hdrs = await authHeaders(pk, t.derive_wallet);
  const subId = Number(t.subaccount_id);

  const sub = await rpc("private/get_subaccount", { subaccount_id: subId }, hdrs);
  const collaterals = sub?.collaterals ?? [];
  const positions = sub?.positions ?? [];
  const ctx: Ctx = {
    pk, signer, hdrs, subId, collaterals, positions, spot: {},
    equity: Number(sub?.subaccount_value ?? 0),
    maintMargin: Math.abs(Number(sub?.maintenance_margin ?? 0)),
  };

  // hydrate the plan with live account facts, then validate (coherence gate)
  plan.holdings = collaterals
    .filter((c: any) => String(c.asset_name ?? c.currency ?? "").toUpperCase() !== "USDC")
    .map((c: any) => ({ asset: String(c.asset_name ?? c.currency), amount: Math.abs(Number(c.amount ?? 0)) }));
  const assets = Array.from(new Set(plan.legs.map((l) => l.asset.toUpperCase())));
  plan.spot = plan.spot ?? {};
  for (const a of assets) {
    try { plan.spot[a] = await indexPrice(a, ctx.spot); } catch { /* leave unset */ }
  }
  const caps = (cfg.capabilities ?? undefined) as Capabilities | undefined;
  const vr = validatePlan(plan, caps);
  if (!vr.ok) {
    return `plan REJECTED (${plan.label}): ${vr.errors.map((e) => `${e.code}${e.legId ? "/" + e.legId : ""}`).join(", ")}`;
  }

  // DCA gate: recurring legs only fire when their cadence has elapsed
  const legState: Record<string, number> = (cfg.leg_last_run ?? {});
  const dueRecurring = (leg: Leg): boolean =>
    plan.schedule.kind !== "recurring" ||
    dcaDue(plan.schedule.everyDays ?? 1, Number(legState[leg.id] ?? 0), Date.now());

  // order budget for the day
  const { count: ordersToday } = await db.from("ledger")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", t.id).in("kind", ["quote_placed", "leg_placed"])
    .gte("ts", new Date(Date.now() - 86400_000).toISOString());
  if ((ordersToday ?? 0) >= Number(cfg.max_orders_per_day ?? 40)) {
    return `order budget reached (${ordersToday}/24h) · ${plan.label}`;
  }

  // refresh our resting maker quotes each cycle
  try { await rpc("private/cancel_by_label", { subaccount_id: subId, label: LABEL }, hdrs); } catch { /* noop */ }

  const notes: string[] = [];
  const firedRecurring: string[] = [];
  for (const leg of plan.legs) {
    // recurring (DCA) legs skip until due; maker legs re-quote every cycle
    const recurring = plan.schedule.kind === "recurring" && (leg.venue === "spot" || leg.venue === "perp") && leg.side === "buy";
    if (recurring && !dueRecurring(leg)) { notes.push(`${leg.id}: not due`); continue; }
    try {
      const r = await execLeg(db, t, cfg, plan, leg, ctx);
      notes.push(r);
      if (recurring && isLive(cfg) && !r.includes("skip")) firedRecurring.push(leg.id);
    } catch (e) {
      notes.push(`${leg.id}: ERR ${String(e).slice(0, 100)}`);
    }
  }

  // persist DCA cadence marks for legs we actually fired
  if (firedRecurring.length) {
    const next = { ...legState };
    for (const id of firedRecurring) next[id] = Date.now();
    await db.from("tenants").update({ config: { ...cfg, leg_last_run: next } }).eq("id", t.id);
  }

  const mode = isLive(cfg) ? "" : "DRY ";
  return `${mode}${plan.label} · ${notes.join(" · ")}`;
}
