import { useState } from "react";
import { HostedStatus, hostedSetLive, hostedPause, hostedUnwind, strategyLabel } from "../../lib/hosted";
import { fmtUsd } from "../../lib/options";

/**
 * The always-visible agent status + control strip, shown on a mainnet
 * instance once the connected wallet has a hosted account. Surfaces exactly
 * what's running and the three controls a real operator needs: go live /
 * pause (dry-run) / kill. Owner actions only — the whole thing is hidden on
 * the demo network and for non-enrolled wallets.
 */
export function AgentBar({
  st, deriveWallet, ownerEoa, onChanged,
}: {
  st: HostedStatus;
  deriveWallet: string;
  ownerEoa: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const live = st.config?.live === true;
  const killed = (st as { kill?: boolean }).kill === true;
  const unwinding = (st.config as { unwind?: boolean } | undefined)?.unwind === true;
  const orders = st.open_orders ?? [];
  const pos = st.positions ?? [];
  // net debit to flatten: buy back shorts (cost), sell out longs (credit).
  const closeCost = pos.reduce(
    (a, p) => a + (p.amount < 0 ? 1 : -1) * Math.abs(p.amount) * (p.mark || 0), 0);

  const act = async (label: string, fn: () => Promise<unknown>, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setErr(""); setBusy(label);
    try { await fn(); await onChanged(); }
    catch (e) { setErr(String((e as Error).message ?? e)); }
    finally { setBusy(null); }
  };

  const state = unwinding
    ? { dot: "bg-amber animate-pulse", text: "UNWINDING (closing out)", cls: "text-amber" }
    : killed
    ? { dot: "bg-rose", text: "PAUSED (killed)", cls: "text-rose" }
    : live
    ? { dot: "bg-mint animate-pulse", text: "AGENT LIVE", cls: "text-mint" }
    : { dot: "bg-amber", text: "DRY-RUN (not trading)", cls: "text-amber" };

  return (
    <div className="mb-2 border-2 border-line bg-pane">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2">
        <span className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.1em]">
          <span className={`inline-block h-2 w-2 rounded-full ${state.dot}`} />
          <span className={state.cls}>{state.text}</span>
        </span>

        {/* the strategy the agent is running */}
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.04em] text-paper">
          {strategyLabel(st.config)}
        </span>
        <span className="h-3.5 w-px bg-line" />

        {/* what's actually resting/held right now */}
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fog">
          {orders.length > 0
            ? orders.map((o) =>
                `${o.direction.toUpperCase()} ${o.amount} ${o.instrument} @ ${o.price}${o.filled > 0 ? ` (${o.filled} filled)` : " (resting)"}`,
              ).join(" · ")
            : pos.length > 0
            ? pos.map((p) => `${p.amount} ${p.instrument} · uPnL ${fmtUsd(p.unrealized_pnl, 0)}`).join(" · ")
            : live ? "no resting order — re-quotes next 15-min cycle" : "nothing working"}
        </span>

        {(st.premium_recent ?? 0) > 0 && (
          <span className="font-mono text-[11px] text-mint">premium {fmtUsd(st.premium_recent ?? 0)}</span>
        )}

        {/* controls */}
        <div className="flex items-center gap-1.5">
          {unwinding && (
            <span className="border-2 border-amber px-2.5 py-1 font-mono text-[10.5px] font-bold uppercase text-amber">
              closing…
            </span>
          )}
          {pos.length > 0 && !unwinding && (
            <button onClick={() => act("unwind", () => hostedUnwind(deriveWallet, ownerEoa),
              `UNWIND — close out all ${pos.length} open position${pos.length > 1 ? "s" : ""} and go FLAT?\n\nThe agent buys back / sells out everything (reduce-only) until your book is empty, then pauses. Estimated ${closeCost >= 0 ? `~$${closeCost.toFixed(0)} to close (debit)` : `~$${Math.abs(closeCost).toFixed(0)} credit`}.\n\nThis is different from Kill: Kill just STOPS the agent and leaves your positions on. Unwind actually CLOSES them so you have no risk.`)}
              disabled={!!busy}
              className="border-2 border-paper bg-amber px-2.5 py-1 font-mono text-[10.5px] font-bold uppercase text-ink shadow-hardsm transition-transform hover:-translate-y-px disabled:opacity-50">
              {busy === "unwind" ? "…" : "Unwind ✕"}
            </button>
          )}
          {!killed && (
            live ? (
              <button onClick={() => act("pause", () => hostedSetLive(deriveWallet, ownerEoa, false))}
                disabled={!!busy}
                className="border-2 border-amber px-2.5 py-1 font-mono text-[10.5px] font-bold uppercase text-amber transition-colors hover:bg-amber hover:text-ink disabled:opacity-50">
                {busy === "pause" ? "…" : "Pause"}
              </button>
            ) : (
              <button onClick={() => act("live", () => hostedSetLive(deriveWallet, ownerEoa, true),
                "Go LIVE with real funds on Derive mainnet?\n\nThe agent places real orders on its next cycle. You can pause anytime.")}
                disabled={!!busy}
                className="border-2 border-paper bg-accent px-2.5 py-1 font-mono text-[10.5px] font-bold uppercase text-ink shadow-hardsm transition-transform hover:-translate-y-px disabled:opacity-50">
                {busy === "live" ? "…" : "Go live →"}
              </button>
            )
          )}
          {killed ? (
            <button onClick={() => act("resume", () => hostedPause(deriveWallet, ownerEoa, false))}
              disabled={!!busy}
              className="border-2 border-mint px-2.5 py-1 font-mono text-[10.5px] font-bold uppercase text-mint transition-colors hover:bg-mint hover:text-ink disabled:opacity-50">
              {busy === "resume" ? "…" : "Un-kill"}
            </button>
          ) : (
            <button onClick={() => act("kill", () => hostedPause(deriveWallet, ownerEoa, true),
              `KILL the agent?\n\nIt stops immediately and places no more orders.${pos.length > 0 ? `\n\n⚠ You still have ${pos.length} open position${pos.length > 1 ? "s" : ""} — Kill does NOT close them. To be fully flat with no risk, use Unwind instead.` : " Your positions are untouched."}\n\nYou can un-kill later.`)}
              disabled={!!busy}
              className="border-2 border-rose px-2.5 py-1 font-mono text-[10.5px] font-bold uppercase text-rose transition-colors hover:bg-rose hover:text-ink disabled:opacity-50">
              {busy === "kill" ? "…" : "Kill"}
            </button>
          )}
        </div>
      </div>
      {err && <div className="border-t border-rose px-3 py-1 font-mono text-[10.5px] text-rose">{err}</div>}
    </div>
  );
}
