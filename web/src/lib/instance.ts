/**
 * Network selection. The app has two backends:
 *   - "demo"    → the public testnet pilot (default). Fake money.
 *   - "mainnet" → the private EU instance. REAL funds. Shown to everyone as a
 *                 dropdown option, but enrollment + trading are gated
 *                 server-side by an allowlist, so a non-whitelisted wallet can
 *                 select it and browse but can't set up or trade.
 *
 * Reads are public (mainnet status by wallet address — only whitelisted
 * wallets have any data). Trading is gated by the allowlist at enrollment,
 * and go-live/pause/kill require a wallet signature from the account owner.
 * (Pilot tradeoff: positions are readable by address; a wallet-signature
 * read gate is the pre-scale hardening step.)
 */
export type Network = "demo" | "mainnet";
export type Instance = { fn: string; key: string; label: string };

const LS = "overwrite_network";
const MAINNET_FN = "https://dpfsvupqssfzwsnhpdmg.supabase.co/functions/v1"; // eu-central-1

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
  return { fn: MAINNET_FN, key: "", label: "MAINNET · REAL FUNDS" };
}
