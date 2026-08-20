/**
 * Client for the hosted pilot (Supabase edge functions).
 * The backend generates + holds an encrypted session key per user; the
 * user authorizes it with one MetaMask tx (same registration flow as the
 * in-browser path). The fleet then trades 24/7 - no laptop required.
 */
import { resolveInstance } from "./instance";

// Default: the public testnet pilot. Overridable per-visitor via the
// ?instance=private share link (see instance.ts) or per-deployment via
// VITE_FN_BASE / VITE_CONSOLE_KEY.
const fnBase = () =>
  resolveInstance()?.fn
  ?? (import.meta as any).env?.VITE_FN_BASE
  ?? "https://xbxopobawxsugtfvrjko.supabase.co/functions/v1";
const consoleKey = () =>
  resolveInstance()?.key ?? (import.meta as any).env?.VITE_CONSOLE_KEY ?? "";

async function post(path: string, body: unknown): Promise<any> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const key = consoleKey();
  if (key) headers["x-console-key"] = key;
  const r = await fetch(`${fnBase()}/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return r.json();
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

/** Owner-only (private instance): flip the agent's live flag or pause it.
 * The server just sets the flag; the fleet cron does any trading itself. */
export const hostedSetLive = (deriveWallet: string, live: boolean) =>
  post("overwrite-control", { derive_wallet: deriveWallet, live });
export const hostedPause = (deriveWallet: string, kill: boolean) =>
  post("overwrite-control", { derive_wallet: deriveWallet, kill });
