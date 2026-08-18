/**
 * Shared Derive v2 testnet helpers for the Overwrite hosted pilot.
 * Signing is the same byte-exact port that is golden-tested against the
 * official python lib in scripts/golden_check.mts.
 */
import { encodeAbiParameters, keccak256, getAddress, type Hex } from "npm:viem@2";
import { generatePrivateKey, privateKeyToAccount } from "npm:viem@2/accounts";
import { createClient } from "npm:@supabase/supabase-js@2";

export const BASE = "https://api-demo.lyra.finance";
export const DOMAIN_SEPARATOR = "0x9bcf4dc06df5d8bf23af818d5716491b995020f377d3b7b64c29ed14e3dd1105" as Hex;
export const ACTION_TYPEHASH = "0x4d7a9f27c403ff9c0f19bce61d76d82f9aa29f8d6d4b0c5474607d9770d1af17" as Hex;
export const TRADE_MODULE = "0x87F2863866D85E3192a35A73b388BD625D83f2be";

export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
export const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "content-type": "application/json" } });

export const sb = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

/* ---- keystore: AES-GCM, key derived from the service-role secret ------ */
async function aesKey(): Promise<CryptoKey> {
  const seed = new TextEncoder().encode(
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! + ":overwrite-keystore-v1");
  const digest = await crypto.subtle.digest("SHA-256", seed);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptPk(pk: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, await aesKey(), new TextEncoder().encode(pk)));
  const buf = new Uint8Array(iv.length + ct.length);
  buf.set(iv); buf.set(ct, iv.length);
  return btoa(String.fromCharCode(...buf));
}
export async function decryptPk(enc: string): Promise<Hex> {
  const buf = Uint8Array.from(atob(enc), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: buf.slice(0, 12) }, await aesKey(), buf.slice(12));
  return new TextDecoder().decode(pt) as Hex;
}
export const newSessionKey = () => {
  const pk = generatePrivateKey();
  return { pk, address: privateKeyToAccount(pk).address };
};

/* ---- signing (byte-exact port) ---------------------------------------- */
export function dec18(value: string | number): bigint {
  const s = String(value);
  const neg = s.startsWith("-");
  const [i, fRaw = ""] = (neg ? s.slice(1) : s).split(".");
  const f = (fRaw + "0".repeat(18)).slice(0, 18);
  const out = BigInt(i || "0") * 10n ** 18n + BigInt(f);
  return neg ? -out : out;
}
export const actionNonce = () => BigInt(`${Date.now()}001`);

export function encodeTrade(d: {
  assetAddress: string; subId: bigint; limitPrice: string; amount: string;
  maxFee: string; recipientId: number; isBid: boolean;
}): Hex {
  return encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "int256" },
     { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "bool" }],
    [getAddress(d.assetAddress), d.subId, dec18(d.limitPrice), dec18(d.amount),
     dec18(d.maxFee), BigInt(d.recipientId), d.isBid]);
}
export function typedHash(a: {
  subaccountId: number; nonce: bigint; moduleDataEncoded: Hex;
  signatureExpirySec: number; owner: string; signer: string;
}): Hex {
  const ah = keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "address" },
     { type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" }],
    [ACTION_TYPEHASH, BigInt(a.subaccountId), a.nonce, getAddress(TRADE_MODULE),
     keccak256(a.moduleDataEncoded), BigInt(a.signatureExpirySec),
     getAddress(a.owner), getAddress(a.signer)]));
  return keccak256(`0x1901${DOMAIN_SEPARATOR.slice(2)}${ah.slice(2)}` as Hex);
}
export async function authHeaders(pk: Hex, wallet: string): Promise<Record<string, string>> {
  const account = privateKeyToAccount(pk);
  const ts = String(Date.now());
  return {
    "X-LYRAWALLET": wallet,
    "X-LYRATIMESTAMP": ts,
    "X-LYRASIGNATURE": await account.signMessage({ message: ts }),
  };
}

/* ---- API -------------------------------------------------------------- */
export async function rpc(path: string, params: unknown, headers: Record<string, string> = {},
  rawNonce?: bigint): Promise<any> {
  let body = JSON.stringify(params ?? {});
  if (rawNonce !== undefined) body = body.replace('"__nonce__"', rawNonce.toString());
  const r = await fetch(`${BASE}/${path}`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body,
  });
  const j = await r.json();
  if (j?.error) throw new Error(`${path}: ${JSON.stringify(j.error).slice(0, 300)}`);
  return j.result ?? j;
}

/* ---- small BS helpers for strike selection ----------------------------- */
const erf = (x: number) => {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
};
const cdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
export const callDelta = (s: number, k: number, v: number, t: number) =>
  t <= 0 ? (s > k ? 1 : 0) : cdf((Math.log(s / k) + 0.5 * v * v * t) / (v * Math.sqrt(t)));
export const annYield = (prem: number, spot: number, dte: number) =>
  spot > 0 && dte > 0 ? (prem / spot) * (365 / dte) : 0;
export const quantize = (value: number, step: string): string => {
  const s = Number(step) || 0.0001;
  const q = Math.floor(value / s) * s;
  const dp = (step.split(".")[1] ?? "").length;
  return q.toFixed(dp);
};
