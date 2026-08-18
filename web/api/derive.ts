/**
 * /api/derive - CORS-safe proxy to the Derive v2 TESTNET API.
 *
 * POST { path, params, headers? } → forwards to api-demo.lyra.finance/<path>.
 * Method allowlist only; X-LYRA* auth headers passed through untouched (the
 * session key signs in the user's browser - this server never sees keys).
 * Also proxies a single eth_chainId call to the Derive testnet RPC so the
 * frontend can add the chain to MetaMask without hardcoding the id.
 */
export const config = { runtime: "edge" };

const BASE = "https://api-demo.lyra.finance";
const RPC = "https://testnet-rpc.derive.xyz";

const ALLOWED = new Set([
  // market data
  "public/get_all_currencies",
  "public/get_instruments",
  "public/get_instrument",
  "public/get_ticker",
  // session key registration (owner-EOA flow)
  "public/build_register_session_key_tx",
  "public/register_session_key",
  // account reads (session-key auth)
  "private/get_subaccounts",
  "private/get_subaccount",
  "private/session_keys",
  // trading (session-key signed actions; testnet only by construction)
  "private/order",
  "private/get_open_orders",
  "private/cancel",
  "private/cancel_all",
]);

/* per-instance best-effort rate limit: 30 req/min/IP */
const hits = new Map<string, { n: number; t: number }>();
function limited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) {
    if (hits.size > 5_000) hits.clear();
    hits.set(ip, { n: 1, t: now });
    return false;
  }
  h.n += 1;
  return h.n > 30;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (limited(ip)) return json({ error: "rate_limited" }, 429);

  let body: { path?: string; params?: unknown; headers?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  // chain-id passthrough for wallet_addEthereumChain
  if (body.path === "rpc/chain_id") {
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    return json(await r.json(), r.status);
  }

  const path = String(body.path ?? "");
  if (!ALLOWED.has(path)) return json({ error: "path_not_allowed", path }, 403);

  const fwd: Record<string, string> = { "content-type": "application/json" };
  for (const [k, v] of Object.entries(body.headers ?? {})) {
    if (/^x-lyra/i.test(k) && typeof v === "string" && v.length < 600) fwd[k] = v;
  }

  // params may contain a >2^53 nonce serialized as the string "__bigint__<digits>"
  const raw = JSON.stringify(body.params ?? {})
    .replace(/"__bigint__(\d+)"/g, "$1");

  const r = await fetch(`${BASE}/${path}`, { method: "POST", headers: fwd, body: raw });
  const text = await r.text();
  return new Response(text, {
    status: r.status,
    headers: { "content-type": r.headers.get("content-type") ?? "application/json" },
  });
}
