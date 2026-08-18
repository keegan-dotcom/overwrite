import { readFileSync } from "fs";
import {
  encodeTradeModuleData, actionHash, typedDataHash, signAction, authHeaders,
} from "/home/claude/work/overwrite/web/src/lib/deriveSign.ts";

const g = JSON.parse(readFileSync("/tmp/golden.json", "utf8"));
const PK = ("0x" + "ab".repeat(32)) as `0x${string}`;

const md = encodeTradeModuleData({
  assetAddress: "0xBcB494059969DAaB460E0B5d4f5c2366aab79aa1",
  subId: 39614082287924319838483674368n,
  limitPrice: "41.5",
  amount: "0.3",
  maxFee: "1000",
  recipientId: 144481,
  isBid: false,
});
const inputs = {
  subaccountId: 144481,
  nonce: 1755550000000001n,
  moduleAddress: "0x87F2863866D85E3192a35A73b388BD625D83f2be",
  moduleDataEncoded: md,
  signatureExpirySec: 1790000000,
  owner: "0x55853CB4f27aDD6d2aB8AE0Fe7437Fd6A4DD482d",
  signer: g.signer,
};
const ah = actionHash(inputs);
const th = typedDataHash(inputs);
const sig = await signAction(PK, inputs);
const hdrs = await authHeaders(PK, "0x55853CB4f27aDD6d2aB8AE0Fe7437Fd6A4DD482d", 1755550001234);

const eq = (a: string, b: string, label: string) => {
  const ok = a.toLowerCase() === b.toLowerCase();
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) { console.log("  ts:", a, "\n  py:", b); process.exitCode = 1; }
};
eq(md, g.module_data_encoded, "module data encoding");
eq(ah, g.action_hash, "action hash");
eq(th, g.typed_data_hash, "typed data hash");
eq(sig, g.signature, "order signature");
eq(hdrs["X-LYRASIGNATURE"], g.auth_signature, "auth header signature");
