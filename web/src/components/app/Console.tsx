import { useCallback, useEffect, useRef, useState } from "react";
import { HostedStatus, hostedStatus } from "../../lib/hosted";
import { fmtUsd } from "../../lib/options";

/**
 * The Console: your real account, live from Derive testnet. Positions, open
 * orders, collateral, premium collected and the fleet's cycle log - fetched
 * through the hosted backend (which holds the trading-scoped read key), so
 * nothing needs to be signed in the browser. Refreshes every 30s.
 *
 * Looks up by whichever address it has: the Derive wallet saved during
 * hosted setup, or the connected EOA (the backend maps it to your account).
 */
export function Console({ ownerEoa }: { ownerEoa: string | null }) {
  const [savedWallet, setSavedWallet] = useState(() => {
    try { return localStorage.getItem("overwrite_derive_wallet") ?? ""; } catch { return ""; }
  });
  const [input, setInput] = useState("");
  const [st, setSt] = useState<HostedStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const timer = useRef<number | null>(null);

  const lookup = savedWallet || ownerEoa || "";

  const refresh = useCallback(async (addr: string) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return;
    setLoading(true);
    try {
      const s = await hostedStatus(addr);
      setSt(s);
      setFetchedAt(new Date());
      if (s.enrolled && s.derive_wallet) {
        try { localStorage.setItem("overwrite_derive_wallet", s.derive_wallet); } catch { /* noop */ }
        setSavedWallet(s.derive_wallet);
      }
    } catch { /* endpoint hiccup - keep last view */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!lookup) return;
    void refresh(lookup);
    timer.current = window.setInterval(() => void refresh(lookup), 30_000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [lookup, refresh]);

  const active = st?.enrolled && st.status === "active";
  const cell = "px-3 py-1.5 font-mono text-[11.5px]";
  const th = "px-3 py-1 text-left font-mono text-[9.5px] uppercase tracking-[0.12em] text-fog";

  /* ---- empty state: not connected / not enrolled ---------------------- */
  if (!st?.enrolled) {
    return (
      <div className="mx-auto max-w-2xl border-2 border-line bg-pane p-6">
        <div className="font-display text-2xl uppercase text-paper">Your account console</div>
        <p className="mt-2 font-serif text-[14px] leading-relaxed text-paper/85">
          Live positions, open orders, collateral and premium collected — pulled
          straight from your Derive testnet account. It lights up once the 24/7
          agent is running:
        </p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 font-serif text-[13.5px] text-paper/85">
          <li>On the <span className="font-bold text-paper">Trade desk</span>, pick a strategy and hit <span className="font-bold text-mint">Approve &amp; deploy</span>.</li>
          <li>Choose <span className="font-bold text-mint">24/7 hosted</span> and authorize the agent's key (one time, gasless).</li>
          <li>Come back here — every order, fill and cycle shows up live.</li>
        </ol>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.trim())}
            placeholder="Already set up? Paste your Derive wallet 0x…"
            className="min-w-0 flex-1 border-2 border-line bg-ink px-3 py-2 font-mono text-[12px] text-paper placeholder:text-fog/60 focus:border-mint focus:outline-none"
          />
          <button
            onClick={() => void refresh(input)}
            disabled={loading || !/^0x[0-9a-fA-F]{40}$/.test(input)}
            className="border-2 border-paper bg-accent px-4 py-2 font-mono text-[12px] font-bold uppercase text-ink shadow-hardsm disabled:opacity-50"
          >
            {loading ? "checking…" : "Look up"}
          </button>
        </div>
        {ownerEoa && !loading && (
          <p className="mt-3 font-mono text-[10.5px] uppercase text-fog">
            checked {ownerEoa.slice(0, 6)}…{ownerEoa.slice(-4)} — no hosted account yet
          </p>
        )}
      </div>
    );
  }

  /* ---- live account view ---------------------------------------------- */
  return (
    <div className="space-y-2">
      {/* summary strip */}
      <div className="grid grid-cols-2 gap-px border-2 border-line bg-line sm:grid-cols-4">
        {[
          ["Account value", st.equity_usd != null ? fmtUsd(st.equity_usd) : "—"],
          ["Premium collected", fmtUsd(st.premium_recent ?? 0)],
          ["Open positions", String(st.positions?.length ?? 0)],
          ["Working orders", String(st.open_orders?.length ?? 0)],
        ].map(([k, v]) => (
          <div key={k} className="bg-pane px-3 py-2">
            <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-fog">{k}</div>
            <div className="font-display text-lg leading-tight text-paper">{v}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-2 border-line bg-pane px-3 py-1.5 font-mono text-[10.5px] uppercase">
        <span className={active ? "text-mint" : "text-amber"}>
          ● {active ? "agent active" : st.status}
        </span>
        {st.subaccount_id != null && <span className="text-fog">subaccount {st.subaccount_id}</span>}
        {st.last_cycle_at && (
          <span className="text-fog">last cycle {new Date(st.last_cycle_at).toLocaleTimeString()}</span>
        )}
        {(st.collaterals ?? []).map((c) => (
          <span key={c.asset} className="text-paper">
            {c.asset} {c.amount.toLocaleString(undefined, { maximumFractionDigits: 3 })}
          </span>
        ))}
        <span className="min-w-0 flex-1" />
        {fetchedAt && <span className="text-fog normal-case">as of {fetchedAt.toLocaleTimeString()}</span>}
        <button onClick={() => void refresh(lookup)} disabled={loading}
          className="border border-line px-2 py-0.5 text-[10px] text-fog hover:border-fog hover:text-paper disabled:opacity-50">
          {loading ? "…" : "refresh"}
        </button>
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        {/* positions */}
        <div className="border-2 border-line bg-pane">
          <div className="border-b-2 border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fog">
            Positions
          </div>
          {(st.positions?.length ?? 0) === 0 ? (
            <p className="px-3 py-3 font-serif text-[12.5px] italic text-fog">
              No open positions — the agent's first order fills on the next taker.
            </p>
          ) : (
            <table className="w-full">
              <thead><tr className="border-b border-line">
                <th className={th}>Instrument</th><th className={th}>Size</th>
                <th className={th}>Avg / Mark</th><th className={th}>uPnL</th><th className={th}>Δ</th>
              </tr></thead>
              <tbody>
                {st.positions!.map((p) => (
                  <tr key={p.instrument} className="border-b border-line/50">
                    <td className={`${cell} text-paper`}>{p.instrument}</td>
                    <td className={`${cell} ${p.amount < 0 ? "text-amber" : "text-mint"}`}>{p.amount}</td>
                    <td className={`${cell} text-fog`}>{p.avg_price.toFixed(1)} / {p.mark.toFixed(1)}</td>
                    <td className={`${cell} ${p.unrealized_pnl >= 0 ? "text-mint" : "text-rose"}`}>
                      {fmtUsd(p.unrealized_pnl, 0)}
                    </td>
                    <td className={`${cell} text-fog`}>{p.delta.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* open orders */}
        <div className="border-2 border-line bg-pane">
          <div className="border-b-2 border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fog">
            Working orders
          </div>
          {(st.open_orders?.length ?? 0) === 0 ? (
            <p className="px-3 py-3 font-serif text-[12.5px] italic text-fog">
              Nothing resting — a fresh quote goes out on the next 15-minute cycle.
            </p>
          ) : (
            <table className="w-full">
              <thead><tr className="border-b border-line">
                <th className={th}>Instrument</th><th className={th}>Side</th>
                <th className={th}>Size</th><th className={th}>Limit</th><th className={th}>Filled</th>
              </tr></thead>
              <tbody>
                {st.open_orders!.map((o, i) => (
                  <tr key={i} className="border-b border-line/50">
                    <td className={`${cell} text-paper`}>{o.instrument}</td>
                    <td className={`${cell} ${o.direction === "sell" ? "text-amber" : "text-mint"}`}>
                      {o.direction.toUpperCase()}
                    </td>
                    <td className={cell + " text-paper"}>{o.amount}</td>
                    <td className={cell + " text-paper"}>{o.price.toFixed(1)}</td>
                    <td className={cell + " text-fog"}>{o.filled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* activity ledger */}
        <div className="border-2 border-line bg-pane">
          <div className="border-b-2 border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fog">
            Activity
          </div>
          <div className="max-h-56 overflow-y-auto">
            {(st.ledger ?? []).length === 0 ? (
              <p className="px-3 py-3 font-serif text-[12.5px] italic text-fog">No activity yet.</p>
            ) : (
              (st.ledger ?? []).map((l, i) => (
                <div key={i} className="flex items-center gap-3 border-b border-line/50 px-3 py-1 font-mono text-[11px]">
                  <span className="text-fog">{new Date(l.ts).toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className={l.kind === "premium_in" ? "text-mint" : l.kind === "buyback_out" ? "text-rose" : "text-paper"}>
                    {l.kind.replace("_", " ")}
                  </span>
                  <span className="min-w-0 flex-1 truncate px-2 text-right text-fog">{l.instrument}</span>
                  <span className="text-paper">{fmtUsd(Number(l.usd), 1)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* cycle log */}
        <div className="border-2 border-line bg-pane">
          <div className="border-b-2 border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fog">
            Agent log · every 15 min
          </div>
          <div className="max-h-56 overflow-y-auto px-3 py-1.5 font-mono text-[11px] leading-relaxed">
            {(st.cycles ?? []).map((c, i) => (
              <div key={i} className={c.ok ? "text-fog" : "text-rose"}>
                <span className="text-fog/60">{new Date(c.ts).toLocaleTimeString()}</span>{" "}
                <span className={c.ok ? "text-paper/80" : "text-rose"}>{c.msg}</span>
              </div>
            ))}
            {st.last_error && <div className="text-rose">last error: {st.last_error}</div>}
          </div>
        </div>
      </div>

      <p className="px-1 font-serif text-[11px] italic text-fog">
        Derive testnet · read-only view via the fleet's trading-scoped key ·
        revoke any time at testnet.derive.xyz → Developers
      </p>
    </div>
  );
}
