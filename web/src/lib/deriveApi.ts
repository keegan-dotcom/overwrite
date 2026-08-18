/**
 * Derive v2 testnet client for the browser, via the /api/derive proxy.
 * Market data, session-key registration (owner EOA pays gas on Derive
 * Chain via MetaMask), and signed order placement. Testnet only.
 */
import type { Hex } from "viem";
import {
  DERIVE_TESTNET, TradeModuleData, actionNonce, authHeaders,
  encodeTradeModuleData, signAction,
} from "./deriveSign";

type Rpc = (path: string, params?: unknown, headers?: Record<string, string>) => Promise<any>;

export const rpc: Rpc = async (path, params = {}, headers) => {
  const r = await fetch("/api/derive", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, params, headers }),
  });
  const j = await r.json();
  if (j?.error && !j?.result) throw new Error(typeof j.error === "string" ? j.error : JSON.stringify(j.error));
  return j.result ?? j;
};

/* ---- market data ------------------------------------------------------ */

export type LiveInstrument = {
  instrument_name: string;
  base_asset_address: string;
  base_asset_sub_id: string;
  option_details?: { expiry: number; strike: string; option_type: "C" | "P" };
  tick_size: string;
  amount_step: string;
  minimum_amount: string;
};

export async function fetchOptionChain(currency: string): Promise<LiveInstrument[]> {
  const res = await rpc("public/get_instruments", {
    currency, expired: false, instrument_type: "option",
  });
  return (res ?? []) as LiveInstrument[];
}

/** Nearest live call to the structured (strike, dte) intent. */
export function matchCall(
  chain: LiveInstrument[], strike: number, dteDays: number,
): LiveInstrument | null {
  const targetExpiry = Date.now() / 1000 + dteDays * 86400;
  const calls = chain.filter((i) => i.option_details?.option_type === "C");
  if (!calls.length) return null;
  let best: LiveInstrument | null = null;
  let bestScore = Infinity;
  for (const c of calls) {
    const d = c.option_details!;
    const strikeErr = Math.abs(Number(d.strike) - strike) / strike;
    const dteErr = Math.abs(d.expiry - targetExpiry) / (30 * 86400);
    const score = strikeErr * 2 + dteErr;
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}

export async function fetchTicker(instrumentName: string): Promise<{
  mark_price: string; best_bid_price: string; best_ask_price: string; index_price: string;
}> {
  return rpc("public/get_ticker", { instrument_name: instrumentName });
}

/* ---- session key registration (owner EOA pays gas via MetaMask) ------- */

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const eth = (): Eip1193 => (window as any).ethereum;

export async function deriveChainIdHex(): Promise<string> {
  const j = await fetch("/api/derive", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "rpc/chain_id" }),
  }).then((r) => r.json());
  return j.result as string; // e.g. "0x385" -> 901
}

export async function switchToDeriveChain(): Promise<string> {
  const chainId = await deriveChainIdHex();
  try {
    await eth().request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch {
    await eth().request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId,
        chainName: "Derive Testnet",
        rpcUrls: [DERIVE_TESTNET.RPC],
        blockExplorerUrls: [DERIVE_TESTNET.EXPLORER],
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      }],
    });
    await eth().request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  }
  return chainId;
}

/** Build the registration tx via the API, send it from MetaMask on Derive
 * Chain (owner pays a tiny amount of testnet gas). Returns the tx hash. */
export async function registerSessionKey(
  deriveWallet: string, sessionKeyAddress: string, ownerEoa: string,
): Promise<string> {
  const expiry = Math.floor(Date.now() / 1000) + 30 * 86400; // 30 days
  const built = await rpc("public/build_register_session_key_tx", {
    wallet: deriveWallet,
    public_session_key: sessionKeyAddress,
    expiry_sec: expiry,
  });
  const tx = built.tx_params as Record<string, unknown>;
  await switchToDeriveChain();
  const hash = (await eth().request({
    method: "eth_sendTransaction",
    params: [{
      from: ownerEoa,
      to: tx.to,
      data: tx.data,
      value: tx.value ?? "0x0",
    }],
  })) as string;
  return hash;
}

/** True once the API authenticates the session key for this wallet. */
export async function sessionKeyActive(pk: Hex, deriveWallet: string): Promise<boolean> {
  try {
    const res = await rpc("private/session_keys", { wallet: deriveWallet },
      await authHeaders(pk, deriveWallet));
    return Array.isArray(res?.public_session_keys ?? res?.session_keys ?? res) || res != null;
  } catch {
    return false;
  }
}

export async function fetchSubaccounts(pk: Hex, deriveWallet: string): Promise<number[]> {
  const res = await rpc("private/get_subaccounts", { wallet: deriveWallet },
    await authHeaders(pk, deriveWallet));
  const subs = res?.subaccount_ids ?? res?.subaccounts?.map((s: any) => s.subaccount_id) ?? [];
  return subs as number[];
}

/* ---- order placement -------------------------------------------------- */

export type PlacedOrder = { order_id: string; instrument_name: string; limit_price: string; amount: string };

export async function placeSellCall(opts: {
  pk: Hex;
  deriveWallet: string;
  subaccountId: number;
  instrument: LiveInstrument;
  limitPrice: string; // decimal string, already tick-quantized
  amount: string;     // decimal string, already step-quantized
}): Promise<PlacedOrder> {
  const nonce = actionNonce();
  const expirySec = Math.floor(Date.now() / 1000) + 3600; // 1h
  const md: TradeModuleData = {
    assetAddress: opts.instrument.base_asset_address,
    subId: BigInt(opts.instrument.base_asset_sub_id),
    limitPrice: opts.limitPrice,
    amount: opts.amount,
    maxFee: "1000",
    recipientId: opts.subaccountId,
    isBid: false,
  };
  const signature = await signAction(opts.pk, {
    subaccountId: opts.subaccountId,
    nonce,
    moduleAddress: DERIVE_TESTNET.TRADE_MODULE,
    moduleDataEncoded: encodeTradeModuleData(md),
    signatureExpirySec: expirySec,
    owner: opts.deriveWallet,
    signer: (await import("viem/accounts")).privateKeyToAccount(opts.pk).address,
  });
  const res = await rpc("private/order", {
    instrument_name: opts.instrument.instrument_name,
    direction: "sell",
    order_type: "limit",
    time_in_force: "post_only",
    amount: opts.amount,
    limit_price: opts.limitPrice,
    max_fee: "1000",
    subaccount_id: opts.subaccountId,
    nonce: `__bigint__${nonce}`,           // proxy unwraps to a JSON integer
    signature,
    signature_expiry_sec: expirySec,
    signer: (await import("viem/accounts")).privateKeyToAccount(opts.pk).address,
    mmp: false,
    reduce_only: false,
    label: "overwrite-web",
  }, await authHeaders(opts.pk, opts.deriveWallet));
  const order = res?.order ?? res;
  return {
    order_id: order?.order_id ?? "?",
    instrument_name: order?.instrument_name ?? opts.instrument.instrument_name,
    limit_price: order?.limit_price ?? opts.limitPrice,
    amount: order?.amount ?? opts.amount,
  };
}

/** Quantize helper: floor a decimal value to a step (both decimal strings). */
export function quantize(value: number, step: string): string {
  const s = Number(step);
  if (!isFinite(s) || s <= 0) return String(value);
  const q = Math.floor(value / s) * s;
  const dp = (step.split(".")[1] ?? "").length;
  return q.toFixed(dp);
}
