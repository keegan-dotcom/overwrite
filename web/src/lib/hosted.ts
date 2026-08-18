/**
 * Client for the hosted pilot (Supabase edge functions).
 * The backend generates + holds an encrypted session key per user; the
 * user authorizes it with one MetaMask tx (same registration flow as the
 * in-browser path). The fleet then trades 24/7 - no laptop required.
 */
const FN = "https://xbxopobawxsugtfvrjko.supabase.co/functions/v1";

async function post(path: string, body: unknown): Promise<any> {
  const r = await fetch(`${FN}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

export type HostedStatus = {
  enrolled: boolean;
  status?: "awaiting_registration" | "active" | "paused" | "error";
  subaccount_id?: number;
  session_key_address?: string;
  premium_recent?: number;
  last_cycle_at?: string | null;
  last_error?: string | null;
  ledger?: { ts: string; kind: string; instrument: string; usd: number }[];
  cycles?: { ts: string; ok: boolean; msg: string }[];
};

export const hostedEnroll = (ownerEoa: string, deriveWallet: string) =>
  post("overwrite-enroll", { action: "enroll", owner_eoa: ownerEoa, derive_wallet: deriveWallet });

export const hostedActivate = (deriveWallet: string) =>
  post("overwrite-enroll", { action: "activate", derive_wallet: deriveWallet });

export const hostedStatus = (deriveWallet: string): Promise<HostedStatus> =>
  post("overwrite-status", { derive_wallet: deriveWallet });
