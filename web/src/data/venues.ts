/**
 * Venue modes for the app demo. Facts sourced from the Derive V3 docs
 * (v3.docs.derive.xyz, pre-release) - only documented capabilities are
 * claimed. Tokenized equities are NOT in the V3 docs yet, so they stay
 * "awaiting listing" in both modes.
 */
export type VenueMode = "v2" | "v3";

export type VenueInfo = {
  id: VenueMode;
  label: string;
  short: string;
  endpoint: string;
  settlement: string;
  keyScope: string;      // how the agent's session key is scoped
  vaultNote: string;     // per-user vault story
  extraManaged: string[]; // venue-specific agent behaviors shown on tickets
  settleStages: string[]; // feed lines after a fill
};

export const VENUES: Record<VenueMode, VenueInfo> = {
  v2: {
    id: "v2",
    label: "Derive · v2 testnet",
    short: "v2",
    endpoint: "api-demo.lyra.finance",
    settlement: "on-chain settlement (Derive Chain)",
    keyScope: "session key you register · revoke anytime",
    vaultNote:
      "One vault per user. No pooled funds, no shared honeypot - a hack of someone else's vault can't touch yours.",
    extraManaged: [],
    settleStages: ["settled on Derive Chain"],
  },
  v3: {
    id: "v3",
    label: "Derive V3 · preview",
    short: "V3",
    endpoint: "testnet.api.derive.xyz/v3",
    settlement: "ZK-proven settlement · batch: Batching → Proving → Settled",
    keyScope: "session key scoped trade:orderbook:option only · 30d expiry · IP-whitelisted",
    vaultNote:
      "One vault per user - and on V3, vaults are permissionless: created programmatically per user, no DAO whitelisting. Isolated risk universes keep markets walled off from each other.",
    extraManaged: [
      "Prices every order with the order_quote dry-run before submitting (V3)",
      "Stop-loss runs as a native trigger order on-venue (V3)",
    ],
    settleStages: ["batch: Executing → Proving", "batch: Settled (ZK-proven)"],
  },
};
