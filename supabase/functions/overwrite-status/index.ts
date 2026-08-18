/** Hosted-pilot status: GET/POST {derive_wallet} → tenant + ledger + cycles.
 * Public read-only by design (testnet pilot). */
import { CORS, json, sb } from "../_shared/derive.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  let wallet = url.searchParams.get("wallet") ?? "";
  if (!wallet && req.method === "POST") {
    try { wallet = (await req.json())?.derive_wallet ?? ""; } catch { /* noop */ }
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return json({ error: "invalid wallet" }, 400);
  const db = sb();
  const { data: t } = await db.from("tenants")
    .select("status,subaccount_id,session_key_address,config,last_cycle_at,last_error,kill,created_at")
    .eq("derive_wallet", wallet).maybeSingle();
  if (!t) return json({ enrolled: false });
  const { data: ledger } = await db.from("ledger")
    .select("ts,kind,instrument,usd").eq("tenant_id",
      (await db.from("tenants").select("id").eq("derive_wallet", wallet).single()).data!.id)
    .order("ts", { ascending: false }).limit(25);
  const { data: cycles } = await db.from("cycles")
    .select("ts,ok,msg").eq("tenant_id",
      (await db.from("tenants").select("id").eq("derive_wallet", wallet).single()).data!.id)
    .order("ts", { ascending: false }).limit(10);
  const premium = (ledger ?? []).filter((l) => l.kind === "premium_in")
    .reduce((a, b) => a + Number(b.usd ?? 0), 0);
  return json({ enrolled: true, ...t, premium_recent: premium, ledger, cycles });
});
