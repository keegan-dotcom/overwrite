/**
 * Derive v2 action signing - TypeScript port of the official
 * `derive_action_signing` python library (v0.0.13), byte-for-byte.
 * Golden-tested against the python lib (scripts/golden_sign_test).
 *
 * The session key private key is generated IN THE BROWSER and never leaves
 * localStorage. It can trade on the subaccount it's registered to; it can
 * admin-scoped (Derive has no trade-only scope); revocable anytime.
 */
import { encodeAbiParameters, keccak256, getAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/* Testnet protocol constants - from derive_client config (Environment.TEST) */
export const DERIVE_TESTNET = {
  DOMAIN_SEPARATOR: "0x9bcf4dc06df5d8bf23af818d5716491b995020f377d3b7b64c29ed14e3dd1105" as Hex,
  ACTION_TYPEHASH: "0x4d7a9f27c403ff9c0f19bce61d76d82f9aa29f8d6d4b0c5474607d9770d1af17" as Hex,
  TRADE_MODULE: "0x87F2863866D85E3192a35A73b388BD625D83f2be" as const,
  RPC: "https://testnet-rpc.derive.xyz",
  EXPLORER: "https://explorer-prod-testnet-0eakp60405.t.conduit.xyz",
};

/** decimal string -> 1e18-scaled bigint (exact; no float math) */
export function dec18(value: string | number): bigint {
  const s = String(value);
  const neg = s.startsWith("-");
  const [intPart, fracRaw = ""] = (neg ? s.slice(1) : s).split(".");
  const frac = (fracRaw + "0".repeat(18)).slice(0, 18);
  const out = BigInt(intPart || "0") * 10n ** 18n + BigInt(frac);
  return neg ? -out : out;
}

/** nonce = <utc ms><3-digit suffix> - exceeds 2^53, so bigint end-to-end */
export function actionNonce(suffix = 1): bigint {
  return BigInt(`${Date.now()}${String(suffix).padStart(3, "0")}`);
}

export type TradeModuleData = {
  assetAddress: string;   // option asset contract (e.g. ETH_OPTION)
  subId: bigint;          // instrument sub id
  limitPrice: string;     // decimal string
  amount: string;         // decimal string
  maxFee: string;         // decimal string
  recipientId: number;    // subaccount id
  isBid: boolean;
};

/** abi.encode(["address","uint","int","int","uint","uint","bool"], ...) */
export function encodeTradeModuleData(d: TradeModuleData): Hex {
  return encodeAbiParameters(
    [
      { type: "address" }, { type: "uint256" }, { type: "int256" },
      { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "bool" },
    ],
    [
      getAddress(d.assetAddress), d.subId, dec18(d.limitPrice),
      dec18(d.amount), dec18(d.maxFee), BigInt(d.recipientId), d.isBid,
    ],
  );
}

export type ActionInputs = {
  subaccountId: number;
  nonce: bigint;
  moduleAddress: string;
  moduleDataEncoded: Hex;
  signatureExpirySec: number;
  owner: string;   // the Derive smart-contract wallet
  signer: string;  // the session key address
};

export function actionHash(a: ActionInputs): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" }, { type: "uint256" }, { type: "uint256" },
        { type: "address" }, { type: "bytes32" }, { type: "uint256" },
        { type: "address" }, { type: "address" },
      ],
      [
        DERIVE_TESTNET.ACTION_TYPEHASH, BigInt(a.subaccountId), a.nonce,
        getAddress(a.moduleAddress), keccak256(a.moduleDataEncoded),
        BigInt(a.signatureExpirySec), getAddress(a.owner), getAddress(a.signer),
      ],
    ),
  );
}

export function typedDataHash(a: ActionInputs): Hex {
  return keccak256(
    `0x1901${DERIVE_TESTNET.DOMAIN_SEPARATOR.slice(2)}${actionHash(a).slice(2)}` as Hex,
  );
}

export async function signAction(sessionKeyPk: Hex, a: ActionInputs): Promise<Hex> {
  const account = privateKeyToAccount(sessionKeyPk);
  return account.sign({ hash: typedDataHash(a) });
}

/** REST auth headers: session key personal-signs the utc-ms timestamp. */
export async function authHeaders(
  sessionKeyPk: Hex, deriveWallet: string, timestampMs?: number,
): Promise<Record<string, string>> {
  const account = privateKeyToAccount(sessionKeyPk);
  const ts = String(timestampMs ?? Date.now());
  const signature = await account.signMessage({ message: ts });
  return {
    "X-LYRAWALLET": deriveWallet,
    "X-LYRATIMESTAMP": ts,
    "X-LYRASIGNATURE": signature,
  };
}

/* ---- browser session key management (localStorage) ------------------- */

const SKEY = "overwrite_session_key_testnet";

export function getOrCreateSessionKey(): { pk: Hex; address: string } {
  let pk = (typeof window !== "undefined"
    ? window.localStorage.getItem(SKEY) : null) as Hex | null;
  if (!pk) {
    pk = generatePrivateKey();
    try { window.localStorage.setItem(SKEY, pk); } catch { /* private mode */ }
  }
  return { pk, address: privateKeyToAccount(pk).address };
}

export function clearSessionKey(): void {
  try { window.localStorage.removeItem(SKEY); } catch { /* noop */ }
}
