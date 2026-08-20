/**
 * Instance override: lets the SAME app point at a private (mainnet) backend
 * via a share link, e.g.
 *   https://overwrite.pro/app?instance=private&ikey=<console_key>
 * The override persists in localStorage; ?net=public resets to the testnet
 * pilot. Enrollment on private instances is allowlist-gated server-side, so
 * the link itself grants nothing beyond read access with the console key.
 */
export type Instance = { fn: string; key: string; label: string };

const LS = "overwrite_instance";
// private mainnet instance runs in the EU (eu-central-1) so order placement
// originates from a non-US IP, per Derive's guidance for this account
const PRIVATE_FN = "https://dpfsvupqssfzwsnhpdmg.supabase.co/functions/v1";

export function resolveInstance(): Instance | null {
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get("net") === "public") {
      localStorage.removeItem(LS);
      return null;
    }
    if (p.get("instance") === "private") {
      const v: Instance = {
        fn: PRIVATE_FN,
        key: p.get("ikey") ?? "",
        label: "PRIVATE MAINNET",
      };
      localStorage.setItem(LS, JSON.stringify(v));
      return v;
    }
    const saved = localStorage.getItem(LS);
    return saved ? (JSON.parse(saved) as Instance) : null;
  } catch {
    return null;
  }
}
