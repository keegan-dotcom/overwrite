/**
 * Network selection. The app has two backends:
 *   - "demo"    → the public testnet pilot (default). Fake money.
 *   - "mainnet" → the private EU instance. REAL funds. Shown to everyone as a
 *                 dropdown option, but enrollment + trading are gated
 *                 server-side by an allowlist, so a non-whitelisted wallet can
 *                 select it and browse but can't set up or trade.
 *
 * The mainnet read key is baked in so the dropdown "just works" for everyone.
 * It only grants read access to tenant status; who can trade is the allowlist.
 * (Pilot tradeoff: mainnet positions are readable by wallet address. Only
 * whitelisted wallets have any data. Sign-in auth is the pre-scale fix.)
 */
export type Network = "demo" | "mainnet";
export type Instance = { fn: string; key: string; label: string };

const LS = "overwrite_network";
const MAINNET_FN = "https://dpfsvupqssfzwsnhpdmg.supabase.co/functions/v1"; // eu-central-1
const MAINNET_KEY = "b9206d50965b73585044b68f1f684178c826";

export function getNetwork(): Network {
  try {
    const p = new URLSearchParams(window.location.search);
    // explicit query wins and is remembered
    if (p.get("net") === "public" || p.get("network") === "demo") {
      localStorage.setItem(LS, "demo"); return "demo";
    }
    if (p.get("instance") === "private" || p.get("network") === "mainnet") {
      localStorage.setItem(LS, "mainnet"); return "mainnet";
    }
    return (localStorage.getItem(LS) as Network) === "mainnet" ? "mainnet" : "demo";
  } catch { return "demo"; }
}

export function setNetwork(n: Network) {
  try { localStorage.setItem(LS, n); } catch { /* private mode */ }
}

/** The active private instance, or null on the demo network. */
export function resolveInstance(): Instance | null {
  if (getNetwork() !== "mainnet") return null;
  return { fn: MAINNET_FN, key: MAINNET_KEY, label: "MAINNET · REAL FUNDS" };
}
