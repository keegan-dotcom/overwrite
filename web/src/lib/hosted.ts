/**
 * Client for the hosted pilot (Supabase edge functions).
 * The backend generates + holds an encrypted session key per user; the
 * user authorizes it with one MetaMask tx (same registration flow as the
 * in-browser path). The fleet then trades 24/7 - no laptop required.
 */
import { resolveInstance } from "./instance";

// Default: the public testnet pilot. The mainnet instance is selected via
// the network dropdown (see instance.ts). Reads are public; control actions
// are authorized by a wallet signature (no shared secret).
const fnBase = () =>
  resolveInstance()?.fn
  ?? (import.meta as any).env?.VITE_FN_BASE
  ?? "https://xbxopobawxsugtfvrjko.supabase.co/functions/v1";

async function post(path: string, body: unknown): Promise<any> {
  const r = await fetch(`${fnBase()}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

/** Human label for what the agent is running, from its config. */
export function strategyLabel(config?: { symbol?: string; sweep?: { buy?: string } }): string {
  const sym = (config?.symbol ?? "ETH").toUpperCase();
  const buy = config?.sweep?.buy?.toUpperCase();
  return `${sym} covered-call income${buy ? ` · premium → ${buy}` : ""}`;
}

/* ---- read auth: mainnet reads require an owner signature ---------------- */
// Real-money positions aren't public. The owner signs ONE canonical message;
// the server (overwrite-status) recovers the signer and only returns data if
// it's the account owner. The signature is cached and reused within the
// server's freshness window, so 20-30s polling never re-prompts.
let _readAuth: { owner: string; ts: number; sig: string } | null = null;
let _readDeclinedUntil = 0;

// MUST match the server (supabase overwrite-status) exactly
function readMessage(owner: string, ts: number): string {
  return `Overwrite mainnet read\nowner: ${owner}\nts: ${ts}`;
}

async function ensureReadAuth(
  ownerEoa?: string,
): Promise<{ owner: string; read_ts: number; read_sig: string } | null> {
  const fresh = _readAuth && Date.now() - _readAuth.ts < 25 * 60_000; // server allows 30m
  if (fresh && (!ownerEoa || _readAuth!.owner.toLowerCase() === ownerEoa.toLowerCase())) {
    return { owner: _readAuth!.owner, read_ts: _readAuth!.ts, read_sig: _readAuth!.sig };
  }
  if (!ownerEoa) {
    return _readAuth ? { owner: _readAuth.owner, read_ts: _readAuth.ts, read_sig: _readAuth.sig } : null;
  }
  if (Date.now() < _readDeclinedUntil) return null; // user just rejected - don't nag
  const eth = (window as unknown as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum;
  if (!eth) return null;
  try {
    const ts = Date.now();
    const sig = (await eth.request({ method: "personal_sign", params: [readMessage(ownerEoa, ts), ownerEoa] })) as string;
    _readAuth = { owner: ownerEoa, ts, sig };
    return { owner: ownerEoa, read_ts: ts, read_sig: sig };
  } catch {
    _readDeclinedUntil = Date.now() + 60_000; // back off a minute on rejection
    return null;
  }
}

/** Prompt once for read access on mainnet (public no-op on demo). Returns
 * true if reads are authorized. */
export async function authorizeReads(ownerEoa: string): Promise<boolean> {
  if (!resolveInstance()) return true; // demo reads are public
  return (await ensureReadAuth(ownerEoa)) != null;
}

/* ---- signed control: only the wallet owner can go-live/pause/kill ------- */
// canonical message MUST match the server (supabase overwrite-control) exactly
function controlMessage(deriveWallet: string, patch: Record<string, unknown>, ts: number): string {
  return `Overwrite mainnet control\nwallet: ${deriveWallet}\nset: ${JSON.stringify(patch)}\nts: ${ts}`;
}
async function signedControl(
  deriveWallet: string, ownerEoa: string,
  patch: { live: boolean } | { kill: boolean } | { plan: unknown },
): Promise<any> {
  const eth = (window as unknown as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum;
  if (!eth) throw new Error("no wallet to sign with");
  const ts = Date.now();
  const message = controlMessage(deriveWallet, patch, ts);
  const signature = (await eth.request({ method: "personal_sign", params: [message, ownerEoa] })) as string;
  const r = await post("overwrite-control", { derive_wallet: deriveWallet, owner: ownerEoa, ts, signature, ...patch });
  if (r?.error) throw new Error(r.error);
  return r;
}

export type HostedPosition = {
  instrument: string; amount: number; mark: number;
  avg_price: number; unrealized_pnl: number; delta: number;
};
export type HostedOrder = {
  instrument: string; direction: string; amount: number;
  filled: number; price: number; label: string; ts: number;
};
export type HostedStatus = {
  enrolled: boolean;
  derive_wallet?: string;
  status?: "awaiting_registration" | "active" | "paused" | "error";
  config?: { live?: boolean; symbol?: string; [k: string]: unknown };
  kill?: boolean;
  subaccount_id?: number;
  session_key_address?: string;
  premium_recent?: number;
  last_cycle_at?: string | null;
  last_error?: string | null;
  ledger?: { ts: string; kind: string; instrument: string; usd: number }[];
  cycles?: { ts: string; ok: boolean; msg: string }[];
  // live venue snapshot (present when the fleet key is active)
  positions?: HostedPosition[];
  open_orders?: HostedOrder[];
  collaterals?: { asset: string; amount: number; value_usd: number }[];
  equity_usd?: number;
};

export const hostedEnroll = (ownerEoa: string, deriveWallet: string) =>
  post("overwrite-enroll", { action: "enroll", owner_eoa: ownerEoa, derive_wallet: deriveWallet });

export const hostedActivate = (deriveWallet: string) =>
  post("overwrite-enroll", { action: "activate", derive_wallet: deriveWallet });

export const hostedStatus = async (
  deriveWallet: string, ownerEoa?: string,
): Promise<HostedStatus> => {
  const body: Record<string, unknown> = { derive_wallet: deriveWallet };
  if (resolveInstance()) { // mainnet: attach the owner read-auth signature
    const auth = await ensureReadAuth(ownerEoa);
    if (auth) Object.assign(body, auth);
  }
  return post("overwrite-status", body);
};

/** Owner-only: flip the agent's live flag or pause it. Requires a wallet
 * signature from the account owner; the server just sets the flag. */
export const hostedSetLive = (deriveWallet: string, ownerEoa: string, live: boolean) =>
  signedControl(deriveWallet, ownerEoa, { live });
export const hostedPause = (deriveWallet: string, ownerEoa: string, kill: boolean) =>
  signedControl(deriveWallet, ownerEoa, { kill });

/** Owner-only: deploy a structured plan to the hosted agent. The server always
 * forces it to start dry-run (live:false); the owner reviews dry-run cycles in
 * the Console/AgentBar, then flips it live. Requires a wallet signature. */
export const hostedDeployPlan = (deriveWallet: string, ownerEoa: string, plan: unknown) =>
  signedControl(deriveWallet, ownerEoa, { plan });
