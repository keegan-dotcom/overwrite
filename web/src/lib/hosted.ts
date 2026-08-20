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

/* ---- signed control: only the wallet owner can go-live/pause/kill ------- */
// canonical message MUST match the server (supabase overwrite-control) exactly
function controlMessage(deriveWallet: string, patch: Record<string, unknown>, ts: number): string {
  return `Overwrite mainnet control\nwallet: ${deriveWallet}\nset: ${JSON.stringify(patch)}\nts: ${ts}`;
}
async function signedControl(
  deriveWallet: string, ownerEoa: string, patch: { live: boolean } | { kill: boolean },
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

export const hostedStatus = (deriveWallet: string): Promise<HostedStatus> =>
  post("overwrite-status", { derive_wallet: deriveWallet });

/** Owner-only: flip the agent's live flag or pause it. Requires a wallet
 * signature from the account owner; the server just sets the flag. */
export const hostedSetLive = (deriveWallet: string, ownerEoa: string, live: boolean) =>
  signedControl(deriveWallet, ownerEoa, { live });
export const hostedPause = (deriveWallet: string, ownerEoa: string, kill: boolean) =>
  signedControl(deriveWallet, ownerEoa, { kill });
