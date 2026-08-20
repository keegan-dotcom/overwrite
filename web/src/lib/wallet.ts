/**
 * Read-only wallet integration (Phase 0 of the retail path).
 * Uses the injected EIP-1193 provider directly - no libraries, no
 * signatures beyond account access, nothing custodial. We read balances
 * and size strategy suggestions to what the user actually holds.
 */
import { Holding } from "../data/appdata";

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, cb: (...a: unknown[]) => void) => void;
};

/** A wallet we can connect to. EIP-6963 lets every installed extension announce
 * itself so we never fight over the single window.ethereum slot (which breaks
 * when a user runs more than one wallet — MetaMask + Enkrypt + Rabby, etc.). */
export type WalletProvider = { uuid: string; name: string; icon?: string; provider: Eip1193 };

const announced: WalletProvider[] = [];
if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (e: unknown) => {
    const d = (e as { detail?: { info?: { uuid: string; name: string; icon?: string }; provider?: Eip1193 } }).detail;
    if (!d?.provider || !d.info) return;
    if (!announced.some((p) => p.uuid === d.info!.uuid)) {
      announced.push({ uuid: d.info.uuid, name: d.info.name, icon: d.info.icon, provider: d.provider });
    }
  });
  try { window.dispatchEvent(new Event("eip6963:requestProvider")); } catch { /* SSR / no window */ }
}

/** Guarded read of the legacy injection — window.ethereum can be a getter-only
 * property that THROWS on access when two wallets collide, so never touch it raw. */
function legacyInjected(): Eip1193 | null {
  try { return (window as unknown as { ethereum?: Eip1193 }).ethereum ?? null; } catch { return null; }
}

/** Every wallet we can see: EIP-6963 announcements (multi-wallet safe) first,
 * with the legacy injection as a single fallback entry if none announced. */
export function listProviders(): WalletProvider[] {
  try { window.dispatchEvent(new Event("eip6963:requestProvider")); } catch { /* ignore */ }
  if (announced.length) return announced.slice();
  const inj = legacyInjected();
  return inj ? [{ uuid: "injected", name: "Browser wallet", provider: inj }] : [];
}

export const hasWallet = (): boolean => announced.length > 0 || legacyInjected() != null;

// Ethereum mainnet ERC-20s we can map onto demo assets
const TOKENS: { address: string; decimals: number; symbol: string }[] = [
  { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8, symbol: "BTC" },  // WBTC
  { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, symbol: "USDC" },
];

const BALANCE_OF = "0x70a08231"; // balanceOf(address)

function hexToFloat(hex: string, decimals: number): number {
  try {
    const v = BigInt(hex === "0x" ? "0x0" : hex);
    return Number(v) / 10 ** decimals;
  } catch {
    return 0;
  }
}

export type WalletState = {
  address: string;
  chainId: number;
  holdings: Holding[];   // mapped onto app assets (ETH, BTC via WBTC)
  usdc: number;          // cash collateral (wheel / cash-secured strategies)
};

export async function connectWallet(chosen?: Eip1193): Promise<WalletState | null> {
  const provider = chosen ?? listProviders()[0]?.provider ?? legacyInjected();
  if (!provider) return null;
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts?.[0];
  if (!address) return null;
  const chainHex = (await provider.request({ method: "eth_chainId" })) as string;
  const chainId = parseInt(chainHex, 16);

  const holdings: Holding[] = [];
  let usdc = 0;

  const ethBal = (await provider.request({
    method: "eth_getBalance", params: [address, "latest"],
  })) as string;
  const ethQty = hexToFloat(ethBal, 18);
  // zero balances are included on purpose: the UI shows YOUR portfolio,
  // zeros and all, so it's obvious the screen switched off demo data
  holdings.push({ symbol: "ETH", qty: round(ethQty) });

  if (chainId === 1) {
    for (const t of TOKENS) {
      try {
        const data = BALANCE_OF + address.slice(2).padStart(64, "0");
        const raw = (await provider.request({
          method: "eth_call", params: [{ to: t.address, data }, "latest"],
        })) as string;
        const qty = hexToFloat(raw, t.decimals);
        if (t.symbol === "USDC") usdc = round(qty);
        else holdings.push({ symbol: t.symbol, qty: round(qty) });
      } catch { /* token read failed - skip */ }
    }
  }

  return { address, chainId, holdings, usdc };
}

const round = (x: number) => Math.round(x * 10_000) / 10_000;

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
