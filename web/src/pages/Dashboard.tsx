import { useEffect, useMemo, useState } from "react";
import { Reveal } from "../components/Reveal";

/**
 * Operator dashboard.
 * LIVE mode: fetches /status.json - the file the agent writes each cycle
 * (config `status_export: web/public/status.json`, or `python3 -m agent.main
 * export-status`). Commit+push it (or serve it) and this page shows the real
 * track record. Without it, falls back to clearly-labelled demo data.
 */

type Pos = {
  instrument: string; size: number; entry: number; mark: number;
  delta: number; dte: number | null;
};
type LedgerRow = { ts: string; kind: string; instrument: string; usd: number };
type CycleRow = { ts: string; msg: string };
type Status = {
  generated_at: number;
  venue: string;
  environment?: string;
  dry_run: boolean;
  premium_total_usd: number;
  premium_30d_usd: number;
  orders_24h: number;
  equity_hwm_usd: number | null;
  positions: Pos[];
  ledger: LedgerRow[];
  cycles: CycleRow[];
};

const DEMO_POSITIONS: Pos[] = [
  { instrument: "ETH-20260903-4400-C", size: -5.0, entry: 62.4, mark: 41.2, delta: 0.21, dte: 34.2 },
  { instrument: "ETH-20260917-4600-C", size: -4.0, entry: 71.8, mark: 66.0, delta: 0.24, dte: 48.2 },
  { instrument: "BTC-20260903-112000-C", size: -0.4, entry: 1980.0, mark: 1420.0, delta: 0.22, dte: 34.2 },
];

const DEMO_LEDGER: LedgerRow[] = [
  { ts: "07-30 14:05", kind: "premium_in", instrument: "ETH-20260917-4600-C", usd: 287.2 },
  { ts: "07-29 13:52", kind: "premium_in", instrument: "ETH-20260903-4400-C", usd: 312.0 },
  { ts: "07-29 13:52", kind: "premium_in", instrument: "BTC-20260903-112000-C", usd: 792.0 },
  { ts: "07-25 09:15", kind: "buyback_out", instrument: "ETH-20260820-4300-C", usd: -84.1 },
  { ts: "07-22 10:40", kind: "premium_in", instrument: "ETH-20260820-4300-C", usd: 336.5 },
];

const DEMO_CYCLES: CycleRow[] = [
  { ts: "14:05:11", msg: "ETH: fully covered (9.0/9.0) · no triggers · idle" },
  { ts: "13:50:09", msg: "ETH: sell 4.0 ETH-20260917-4600-C @ 71.8 (0.24Δ, 48d, 16.9% ann) → FILLED" },
  { ts: "13:35:04", msg: "BTC: quote stale (94s) → VETO (fail closed)" },
  { ts: "13:20:02", msg: "ETH: take-profit check: mark 41.2 vs entry 62.4 (66% capture, waits for 75%)" },
];

const EQUITY = [100, 100.4, 100.9, 100.7, 101.3, 101.8, 101.5, 102.1, 102.6, 103.0, 102.8, 103.4];

function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export function Dashboard() {
  const [tab, setTab] = useState<"positions" | "ledger" | "log">("positions");
  const [live, setLive] = useState<Status | null>(null);

  useEffect(() => {
    fetch("/status.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && typeof j.generated_at === "number") setLive(j); })
      .catch(() => {});
  }, []);

  const positions = live ? live.positions : DEMO_POSITIONS;
  const ledger = live ? live.ledger : DEMO_LEDGER;
  const cycles = live ? live.cycles : DEMO_CYCLES;
  const premium30d = useMemo(
    () => live
      ? live.premium_30d_usd
      : DEMO_LEDGER.filter((l) => l.usd > 0).reduce((a, b) => a + b.usd, 0),
    [live]
  );

  return (
    <main className="min-h-screen bg-ink pb-24 pt-28 text-paper"><div className="mx-auto max-w-6xl px-5">
      <Reveal>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl uppercase">Operator console</h1>
            <p className="mt-2 font-mono text-xs text-dfog">
              {live
                ? `venue=${live.venue}${live.environment ? `-${live.environment}` : ""} · ${live.dry_run ? "dry-run" : "LIVE ORDERS"} · updated ${ago(live.generated_at)}`
                : "venue=derive-testnet · subaccount #demo · cycle 900s"}
            </p>
          </div>
          {live ? (
            <span className="flex items-center gap-2 rounded-none border border-mint/60 bg-mint/10 px-4 py-1.5 font-mono text-xs text-mint">
              <span className="live-dot h-2 w-2 bg-mint" /> LIVE DATA — real agent output
            </span>
          ) : (
            <span className="rounded-none border border-amber/50 bg-amber/10 px-4 py-1.5 font-mono text-xs text-amber">
              DEMO DATA — connect your agent (see below)
            </span>
          )}
        </div>
      </Reveal>

      {/* stat row */}
      <Reveal delay={1}>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="premium collected · 30d" value={`$${premium30d.toFixed(0)}`} accent="text-mint"
                foot="ledger: premium_in − buybacks" />
          <Card label={live ? "premium collected · all time" : "equity vs high-water"}
                value={live ? `$${live.premium_total_usd.toFixed(0)}` : "+3.4%"}
                accent="text-mint"
                foot={live ? "since first fill" : "drawdown pause at −15%"} />
          <Card label={live ? "open short calls" : "coverage"}
                value={live ? String(positions.length) : "9.4 / 10.4"}
                accent="text-paper"
                foot={live ? "positions being managed" : "short calls / held units · never > 1.0×"} />
          <Card label={live ? "orders · 24h" : "maintenance usage"}
                value={live ? String(live.orders_24h) : "7.2%"}
                accent="text-paper"
                foot={live ? "incl. maker re-quotes" : "new-risk ceiling 40%"} />
        </div>
      </Reveal>

      {/* equity sparkline (demo only - real curve needs history endpoint) */}
      {!live && (
        <Reveal delay={2}>
          <div className="mt-6 rounded-none border border-darkline bg-pane p-6">
            <div className="flex items-baseline justify-between">
              <p className="font-mono text-xs text-dfog">EQUITY (INDEXED, 12 CYCLES)</p>
              <p className="font-mono text-xs text-mint">103.4</p>
            </div>
            <Sparkline data={EQUITY} />
          </div>
        </Reveal>
      )}

      {/* tabs */}
      <Reveal delay={3}>
        <div className="mt-10">
          <div className="flex gap-2">
            {(["positions", "ledger", "log"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`rounded-none border px-4 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors ${
                  tab === t ? "border-mint bg-mint/10 text-mint" : "border-darkline text-dfog hover:border-fog"
                }`}>
                {t}
              </button>
            ))}
          </div>

          <div className="thin-scroll mt-4 overflow-x-auto rounded-none border border-darkline bg-pane">
            {tab === "positions" && (
              positions.length === 0 ? (
                <p className="p-6 font-mono text-sm text-dfog">
                  No open positions — quotes may be resting (see log).
                </p>
              ) : (
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-darkline font-mono text-[11px] uppercase tracking-wider text-dfog">
                  <tr>{["instrument", "size", "entry", "mark", "Δ", "dte", "premium captured"].map((h) => (
                    <th key={h} className="px-5 py-3 font-medium">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="font-mono">
                  {positions.map((p) => (
                    <tr key={p.instrument} className="border-b border-darkline/50 last:border-0 hover:bg-ink/50">
                      <td className="px-5 py-3.5 text-paper">{p.instrument}</td>
                      <td className="px-5 py-3.5 text-rose">{p.size.toFixed(1)}</td>
                      <td className="px-5 py-3.5 text-dfog">{p.entry.toFixed(1)}</td>
                      <td className="px-5 py-3.5 text-dfog">{p.mark.toFixed(1)}</td>
                      <td className="px-5 py-3.5 text-dfog">{p.delta.toFixed(2)}</td>
                      <td className="px-5 py-3.5 text-dfog">{p.dte != null ? `${p.dte.toFixed(1)}d` : "—"}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-none bg-darkline">
                            <div className="h-full rounded-none bg-mint" style={{ width: `${Math.min(100, Math.max(0, ((p.entry - p.mark) / (p.entry || 1)) * 100))}%` }} />
                          </div>
                          <span className="text-mint">{(((p.entry - p.mark) / (p.entry || 1)) * 100).toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )
            )}
            {tab === "ledger" && (
              ledger.length === 0 ? (
                <p className="p-6 font-mono text-sm text-dfog">No fills yet — premium lands here on the first lift.</p>
              ) : (
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b border-darkline font-mono text-[11px] uppercase tracking-wider text-dfog">
                  <tr>{["time", "kind", "instrument", "usd"].map((h) => (
                    <th key={h} className="px-5 py-3 font-medium">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="font-mono">
                  {ledger.map((l, i) => (
                    <tr key={i} className="border-b border-darkline/50 last:border-0 hover:bg-ink/50">
                      <td className="px-5 py-3.5 text-dfog">{l.ts}</td>
                      <td className="px-5 py-3.5">
                        <span className={l.kind === "premium_in" ? "text-mint" : "text-amber"}>{l.kind}</span>
                      </td>
                      <td className="px-5 py-3.5 text-paper">{l.instrument}</td>
                      <td className={`px-5 py-3.5 ${l.usd >= 0 ? "text-mint" : "text-amber"}`}>
                        {l.usd >= 0 ? "+" : ""}{l.usd.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )
            )}
            {tab === "log" && (
              <div className="p-5 font-mono text-sm">
                {cycles.length === 0 && (
                  <p className="text-dfog">No cycles recorded yet.</p>
                )}
                {cycles.map((c, i) => (
                  <p key={i} className="border-b border-darkline/40 py-2.5 last:border-0">
                    <span className="text-dfog">{c.ts}</span>{" "}
                    <span className={c.msg.includes("VETO") ? "text-amber" : /FILLED|RESTING|sell |buy /.test(c.msg) ? "text-mint" : "text-paper/80"}>
                      {c.msg}
                    </span>
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      </Reveal>

      {!live && (
        <Reveal>
          <div className="mt-10 rounded-none border border-darkline bg-pane p-6">
            <p className="font-mono text-xs uppercase tracking-widest text-dfog">Connect your agent</p>
            <p className="mt-3 text-sm leading-relaxed text-dfog">
              Set <code className="rounded-none bg-ink px-1.5 py-0.5 text-mint">status_export: web/public/status.json</code>{" "}
              in your agent config (or run{" "}
              <code className="rounded-none bg-ink px-1.5 py-0.5 text-mint">python3 -m agent.main export-status</code>),
              commit and push — this page turns into your live track record.
            </p>
          </div>
        </Reveal>
      )}
    </div></main>
  );
}

function Card({ label, value, foot, accent }: { label: string; value: string; foot: string; accent: string }) {
  return (
    <div className="rounded-none border border-darkline bg-pane p-6">
      <p className={`font-display text-3xl ${accent}`}>{value}</p>
      <p className="mt-2 text-sm text-paper">{label}</p>
      <p className="mt-1 font-mono text-[11px] text-dfog">{foot}</p>
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const min = Math.min(...data), max = Math.max(...data);
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * 300},${60 - ((v - min) / (max - min || 1)) * 50}`)
    .join(" ");
  return (
    <svg viewBox="0 0 300 64" className="mt-3 w-full">
      <polyline points={pts} fill="none" stroke="#3DFFA8" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={`0,64 ${pts} 300,64`} fill="rgba(61,255,168,0.08)" stroke="none" />
    </svg>
  );
}
