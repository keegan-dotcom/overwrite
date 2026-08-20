/**
 * Golden test for MAINNET signing constants: byte-compare our TS signing
 * path (same math as supabase/functions/_shared/derive.ts) against the
 * official derive_action_signing python lib run with PROD constants
 * (scripts prints from /tmp/golden_prod.json - see golden_fixture.py with
 * prod DOMAIN_SEPARATOR + TradeModule).
 *
 *   python3 /tmp/golden_prod.py > /tmp/golden_prod.json
 *   npx --prefix web tsx scripts/golden_check_prod.mts
 */
import { readFileSync } from "fs";
import { encodeAbiParameters, keccak256, getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encodeTradeModuleData } from "/home/claude/work/overwrite/web/src/lib/deriveSign.ts";

const PROD = {
  DOMAIN_SEPARATOR: "0xd96e5f90797da7ec8dc4e276260c7f3f87fedf68775fbe1ef116e996fc60441b" as Hex,
  ACTION_TYPEHASH: "0x4d7a9f27c403ff9c0f19bce61d76d82f9aa29f8d6d4b0c5474607d9770d1af17" as Hex,
  TRADE_MODULE: "0xB8D20c2B7a1Ad2EE33Bc50eF10876eD3035b5e7b",
};

const g = JSON.parse(readFileSync("/tmp/golden_prod.json", "utf8"));
const PK = ("0x" + "ab".repeat(32)) as Hex;

const md = encodeTradeModuleData({
  assetAddress: "0xBcB494059969DAaB460E0B5d4f5c2366aab79aa1",
  subId: 39614082287924319838483674368n,
  limitPrice: "41.5",
  amount: "0.3",
  maxFee: "1000",
  recipientId: 144481,
  isBid: false,
});

// same construction as the fleet's typedHash(), with PROD constants
const ah = keccak256(encodeAbiParameters(
  [{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "address" },
   { type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" }],
  [PROD.ACTION_TYPEHASH, 144481n, 1755550000000001n, getAddress(PROD.TRADE_MODULE),
   keccak256(md as Hex), 1790000000n,
   getAddress("0x55853CB4f27aDD6d2aB8AE0Fe7437Fd6A4DD482d"), getAddress(g.signer)]));
const th = keccak256(`0x1901${PROD.DOMAIN_SEPARATOR.slice(2)}${ah.slice(2)}` as Hex);
const account = privateKeyToAccount(PK);
const sig = await account.sign({ hash: th });

const eq = (a: string, b: string, label: string) => {
  const ok = a.toLowerCase() === b.toLowerCase();
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) { console.log("  ts:", a, "\n  py:", b); process.exitCode = 1; }
};
eq(md, g.module_data_encoded, "module data encoding");
eq(ah, g.action_hash, "action hash (PROD trade module)");
eq(th, g.typed_data_hash, "typed data hash (PROD domain separator)");
eq(sig, g.signature, "order signature (PROD)");
console.log(process.exitCode ? "PROD GOLDEN FAILED" : "PROD GOLDEN OK");
