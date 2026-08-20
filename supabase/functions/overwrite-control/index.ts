/** Owner control plane: go-live / pause / kill / set-plan for a tenant. Gated
 * by a WALLET SIGNATURE - the caller must sign the exact action with the owner
 * EOA, and the recovered address must match the tenant's owner. No shared
 * secret; only the real wallet owner can touch their own agent. Never places
 * an order itself - it just sets config; the fleet cron trades on its own
 * schedule, and a newly-set plan always starts dry-run (live:false). */
import { CORS, json, sb } from "./derive.ts";
import { recoverMessageAddress } from "npm:viem";

// canonical message - MUST match the client (web/src/lib/hosted.ts) byte-for-byte
function controlMessage(deriveWallet: string, patch: Record<string, unknown>, ts: number): string {
  return `Overwrite mainnet control\nwallet: ${deriveWallet}\nset: ${JSON.stringify(patch)}\nts: ${ts}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  const wallet = String(body.derive_wallet ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return json({ error: "invalid wallet" }, 400);
  const ts = Number(body.ts ?? 0);
  const signature = String(body.signature ?? "");
  const owner = String(body.owner ?? "").trim();
  if (!signature || !ts || !/^0x[0-9a-fA-F]{40}$/.test(owner)) return json({ error: "missing_signature" }, 400);
  if (Math.abs(Date.now() - ts) > 300_000) return json({ error: "stale_signature" }, 401);

  const patch: Record<string, unknown> = {};
  if (typeof body.live === "boolean") patch.live = body.live;
  else if (typeof body.kill === "boolean") patch.kill = body.kill;
  else if (body.plan && typeof body.plan === "object") patch.plan = body.plan;
  else return json({ error: "nothing_to_set" }, 400);

  // verify the signature authorizes exactly this action
  let recovered: string;
  try {
    recovered = await recoverMessageAddress({
      message: controlMessage(wallet, patch, ts), signature: signature as `0x${string}`,
    });
  } catch { return json({ error: "bad_signature" }, 401); }
  if (recovered.toLowerCase() !== owner.toLowerCase()) return json({ error: "signature_mismatch" }, 401);

  const db = sb();
  const { data: t } = await db.from("tenants")
    .select("id,config,kill,owner_eoa").ilike("derive_wallet", wallet).maybeSingle();
  if (!t) return json({ error: "not_enrolled" }, 404);
  if (String(t.owner_eoa).toLowerCase() !== owner.toLowerCase()) return json({ error: "not_owner" }, 403);

  const cfg = t.config ?? {};
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("live" in patch) update.config = { ...cfg, live: patch.live };
  if ("kill" in patch) update.kill = patch.kill;
  if ("plan" in patch) {
    // a newly-set plan ALWAYS starts dry-run; the owner reviews dry-run cycles
    // and flips live separately. Fresh DCA cadence marks, too.
    update.config = { ...cfg, plan: patch.plan, live: false, leg_last_run: {} };
  }
  await db.from("tenants").update(update).eq("id", t.id);

  return json({
    ok: true,
    live: "plan" in patch ? false : ("live" in patch ? patch.live : (cfg.live ?? false)),
    kill: "kill" in patch ? patch.kill : t.kill,
    plan_set: "plan" in patch,
  });
});
