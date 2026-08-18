/**
 * Enrollment for the hosted pilot (public endpoint by design - it returns
 * only public data: the session key ADDRESS the user must authorize).
 *
 * POST {action:"enroll", owner_eoa, derive_wallet}
 *   → generates a session keypair server-side (private key AES-GCM
 *     encrypted at rest), returns the address to register via MetaMask.
 * POST {action:"activate", derive_wallet}
 *   → verifies the key is registered on Derive, resolves the subaccount,
 *     flips the tenant to active.
 */
import {
  CORS, json, sb, newSessionKey, encryptPk, decryptPk, authHeaders, rpc,
} from "../_shared/derive.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const wallet = String(body.derive_wallet ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return json({ error: "invalid derive_wallet" }, 400);
  const db = sb();

  if (body.action === "enroll") {
    const owner = String(body.owner_eoa ?? "").trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) return json({ error: "invalid owner_eoa" }, 400);
    const { data: existing } = await db.from("tenants")
      .select("session_key_address,status").eq("derive_wallet", wallet).maybeSingle();
    if (existing) {
      return json({ session_key_address: existing.session_key_address, status: existing.status });
    }
    const { pk, address } = newSessionKey();
    const enc = await encryptPk(pk);
    const { error } = await db.from("tenants").insert({
      owner_eoa: owner, derive_wallet: wallet,
      session_key_address: address, session_key_enc: enc,
    });
    if (error) return json({ error: error.message }, 500);
    return json({ session_key_address: address, status: "awaiting_registration" });
  }

  if (body.action === "activate") {
    const { data: t, error } = await db.from("tenants")
      .select("id,session_key_enc,session_key_address").eq("derive_wallet", wallet).maybeSingle();
    if (error || !t) return json({ error: "not_enrolled" }, 404);
    const pk = await decryptPk(t.session_key_enc);
    try {
      const hdrs = await authHeaders(pk, wallet);
      await rpc("private/session_keys", { wallet }, hdrs);          // throws if key not active
      const subs = await rpc("private/get_subaccounts", { wallet }, hdrs);
      const ids: number[] = subs?.subaccount_ids
        ?? subs?.subaccounts?.map((s: any) => s.subaccount_id) ?? [];
      if (!ids.length) return json({ error: "no_subaccounts_for_wallet" }, 400);
      await db.from("tenants").update({
        status: "active", subaccount_id: ids[0], last_error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", t.id);
      return json({ status: "active", subaccount_id: ids[0] });
    } catch (e) {
      return json({
        status: "awaiting_registration",
        detail: `session key ${t.session_key_address} not active yet: ${String(e).slice(0, 200)}`,
      });
    }
  }
  return json({ error: "unknown_action" }, 400);
});
