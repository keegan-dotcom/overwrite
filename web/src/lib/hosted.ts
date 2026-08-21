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
type ReadAuth = { owner: string; ts: number; sig: string };
type ReadPack = { owner: string; read_ts: number; read_sig: string };
const READ_LS = "overwrite_read_auth";
// server freshness window is 120m; reuse a signature well inside that
const READ_REUSE_MS = 110 * 60_000;

function loadReadAuth(): ReadAuth | null {
  try {
    const j = JSON.parse(localStorage.getItem(READ_LS) ?? "null");
    if (j && typeof j.owner === "string" && typeof j.ts === "number" && typeof j.sig === "string") return j;
  } catch { /* noop */ }
  return null;
}
let _readAuth: ReadAuth | null = loadReadAuth();
let _readDeclinedUntil = 0;
// CRITICAL: only ever have ONE signature prompt in flight. Concurrent pollers
// (AppDemo 20s + Console 30s + panel) must share it, or the user gets a queue
// of duplicate Rabby/MetaMask prompts.
let _readInflight: Promise<ReadPack | null> | null = null;

// MUST match the server (supabase overwrite-status) exactly
function readMessage(owner: string, ts: number): string {
  return `Overwrite mainnet read\nowner: ${owner}\nts: ${ts}`;
}
const pack = (a: ReadAuth): ReadPack => ({ owner: a.owner, read_ts: a.ts, read_sig: a.sig });

async function ensureReadAuth(ownerEoa?: string): Promise<ReadPack | null> {
  const fresh = _readAuth && Date.now() - _readAuth.ts < READ_REUSE_MS;
  if (fresh && (!ownerEoa || _readAuth!.owner.toLowerCase() === ownerEoa.toLowerCase())) {
    return pack(_readAuth!);
  }
  if (!ownerEoa) return _readAuth ? pack(_readAuth) : null;
  if (_readInflight) return _readInflight;            // <-- de-dup concurrent prompts
  if (Date.now() < _readDeclinedUntil) return null;   // user just rejected - don't nag
  const eth = (window as unknown as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum;
  if (!eth) return null;
  _readInflight = (async () => {
    try {
      const ts = Date.now();
      const sig = (await eth.request({ method: "personal_sign", params: [readMessage(ownerEoa, ts), ownerEoa] })) as string;
      _readAuth = { owner: ownerEoa, ts, sig };
      try { localStorage.setItem(READ_LS, JSON.stringify(_readAuth)); } catch { /* noop */ }
      return pack(_readAuth);
    } catch {
      _readDeclinedUntil = Date.now() + 60_000; // back off a minute on rejection
      return null;
    } finally {
      _readInflight = null;
    }
  })();
  return _readInflight;
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
  patch: { live: boolean } | { kill: boolean } | { unwind: boolean } | { plan: unknown },
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
  maint_margin_usd?: number;
  init_margin_usd?: number;
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

/** Owner-only: UNWIND — put the agent in close-only mode. It cancels resting
 * orders and buys back / sells out every open option position (reduce-only)
 * until the book is flat, then auto-pauses. Distinct from kill (which just
 * stops and LEAVES positions on). Requires a wallet signature. */
export const hostedUnwind = (deriveWallet: string, ownerEoa: string) =>
  signedControl(deriveWallet, ownerEoa, { unwind: true });

/** Owner-only: deploy a structured plan to the hosted agent. The server always
 * forces it to start dry-run (live:false); the owner reviews dry-run cycles in
 * the Console/AgentBar, then flips it live. Requires a wallet signature. */
export const hostedDeployPlan = (deriveWallet: string, ownerEoa: string, plan: unknown) =>
  signedControl(deriveWallet, ownerEoa, { plan });
