import { useMemo, useState } from "react";
import { Reveal } from "../components/Reveal";

/**
 * Operator dashboard - DEMO MODE.
 * Renders the same shapes the agent writes to sqlite (data/overwrite.db):
 * ledger, orders, cycles, equity. Wire-up path for real data is documented
 * at the bottom of this file and in docs/RUNBOOK.md.
 */

type Pos = {
  instrument: string; size: number; entry: number; mark: number;
  delta: number; dte: number; premiumPct: number;
};

const DEMO_POSITIONS: Pos[] = [
  { instrument: "ETH-20260903-4400-C", size: -5.0, entry: 62.4, mark: 41.2, delta: 0.21, dte: 34.2, premiumPct: 0.34 },
  { instrument: "ETH-20260917-4600-C", size: -4.0, entry: 71.8, mark: 66.0, delta: 0.24, dte: 48.2, premiumPct: 0.08 },
  { instrument: "BTC-20260903-112000-C", size: -0.4, entry: 1980.0, mark: 1420.0, delta: 0.22, dte: 34.2, premiumPct: 0.28 },
];

const DEMO_LEDGER = [
  { ts: "07-30 14:05", kind: "premium_in", instrument: "ETH-20260917-4600-C", usd: 287.2 },
  { ts: "07-29 13:52", kind: "premium_in", instrument: "ETH-20260903-4400-C", usd: 312.0 },
  { ts: "07-29 13:52", kind: "premium_in", instrument: "BTC-20260903-112000-C", usd: 792.0 },
  { ts: "07-25 09:15", kind: "buyback_out", instrument: "ETH-20260820-4300-C", usd: -84.1 },
  { ts: "07-22 10:40", kind: "premium_in", instrument: "ETH-20260820-4300-C", usd: 336.5 },
];

const DEMO_CYCLES = [
  { ts: "14:05:11", msg: "ETH: fully covered (9.0/9.0) · no triggers · idle" },
  { ts: "13:50:09", msg: "ETH: sell 4.0 ETH-20260917-4600-C @ 71.8 (0.24Δ, 48d, 16.9% ann) → FILLED" },
  { ts: "13:35:04", msg: "BTC: quote stale (94s) → VETO (fail closed)" },
  { ts: "13:20:02", msg: "ETH: take-profit check: mark 41.2 vs entry 62.4 (66% capture, waits for 75%)" },
];

const EQUITY = [100, 100.4, 100.9, 100.7, 101.3, 101.8, 101.5, 102.1, 102.6, 103.0, 102.8, 103.4];

export function Dashboard() {
  const [tab, setTab] = useState<"positions" | "ledger" | "log">("positions");
  const premium30d = useMemo(
    () => DEMO_LEDGER.filter((l) => l.usd > 0).reduce((a, b) => a + b.usd, 0),
    []
  );

  return (
    <main className="mx-auto max-w-6xl px-5 pb-24 pt-28">
      <Reveal>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl font-light tracking-tight">Operator console</h1>
            <p className="mt-2 font-mono text-xs text-fog">
              venue=derive-testnet · subaccount #demo · cycle 900s
            </p>
          </div>
          <span className="rounded-full border border-amber/50 bg-amber/10 px-4 py-1.5 font-mono text-xs text-amber">
            DEMO DATA — connect your agent (see below)
          </span>
        </div>
      </Reveal>

      {/* stat row */}
      <Reveal delay={1}>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="premium collected · 30d" value={`$${premium30d.toFixed(0)}`} accent="text-mint"
                foot="ledger: premium_in − buybacks" />
          <Card label="equity vs high-water" value="+3.4%" accent="text-mint" foot="drawdown pause at −15%" />
          <Card label="coverage" value="9.4 / 10.4" accent="text-paper" foot="short calls / held units · never > 1.0×" />
          <Card label="maintenance usage" value="7.2%" accent="text-paper" foot="new-risk ceiling 40%" />
        </div>
      </Reveal>

      {/* equity sparkline */}
      <Reveal delay={2}>
        <div className="mt-6 rounded-2xl border border-line bg-pane p-6">
          <div className="flex items-baseline justify-between">
            <p className="font-mono text-xs text-fog">EQUITY (INDEXED, 12 CYCLES)</p>
            <p className="font-mono text-xs text-mint">103.4</p>
          </div>
          <Sparkline data={EQUITY} />
        </div>
      </Reveal>

      {/* tabs */}
      <Reveal delay={3}>
        <div className="mt-10">
          <div className="flex gap-2">
            {(["positions", "ledger", "log"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`rounded-full border px-4 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors ${
                  tab === t ? "border-mint bg-mint/10 text-mint" : "border-line text-fog hover:border-fog"
                }`}>
                {t}
              </button>
            ))}
          </div>

          <div className="thin-scroll mt-4 overflow-x-auto rounded-2xl border border-line bg-pane">
            {tab === "positions" && (
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-line font-mono text-[11px] uppercase tracking-wider text-fog">
                  <tr>{["instrument", "size", "entry", "mark", "Δ", "dte", "premium captured"].map((h) => (
                    <th key={h} className="px-5 py-3 font-medium">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="font-mono">
                  {DEMO_POSITIONS.map((p) => (
                    <tr key={p.instrument} className="border-b border-line/50 last:border-0 hover:bg-ink/50">
                      <td className="px-5 py-3.5 text-paper">{p.instrument}</td>
                      <td className="px-5 py-3.5 text-rose">{p.size.toFixed(1)}</td>
                      <td className="px-5 py-3.5 text-fog">{p.entry.toFixed(1)}</td>
                      <td className="px-5 py-3.5 text-fog">{p.mark.toFixed(1)}</td>
                      <td className="px-5 py-3.5 text-fog">{p.delta.toFixed(2)}</td>
                      <td className="px-5 py-3.5 text-fog">{p.dte.toFixed(1)}d</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line">
                            <div className="h-full rounded-full bg-mint" style={{ width: `${Math.min(100, ((p.entry - p.mark) / p.entry) * 100)}%` }} />
                          </div>
                          <span className="text-mint">{(((p.entry - p.mark) / p.entry) * 100).toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {tab === "ledger" && (
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b border-line font-mono text-[11px] uppercase tracking-wider text-fog">
                  <tr>{["time", "kind", "instrument", "usd"].map((h) => (
                    <th key={h} className="px-5 py-3 font-medium">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="font-mono">
                  {DEMO_LEDGER.map((l, i) => (
                    <tr key={i} className="border-b border-line/50 last:border-0 hover:bg-ink/50">
                      <td className="px-5 py-3.5 text-fog">{l.ts}</td>
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
            )}
            {tab === "log" && (
              <div className="p-5 font-mono text-sm">
                {DEMO_CYCLES.map((c, i) => (
                  <p key={i} className="border-b border-line/40 py-2.5 last:border-0">
                    <span className="text-fog">{c.ts}</span>{" "}
                    <span className={c.msg.includes("VETO") ? "text-amber" : c.msg.includes("FILLED") ? "text-mint" : "text-paper/80"}>
                      {c.msg}
                    </span>
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      </Reveal>

      <Reveal>
        <div className="mt-10 rounded-2xl border border-line bg-pane p-6">
          <p className="font-mono text-xs uppercase tracking-widest text-fog">Connect your agent</p>
          <p className="mt-3 text-sm leading-relaxed text-fog">
            This console renders demo shapes. Your running agent already records
            everything it does — positions, ledger, cycles, equity — to{" "}
            <code className="rounded bg-ink px-1.5 py-0.5 text-mintdim">data/overwrite.db</code>. Export it:
          </p>
          <pre className="mt-4 overflow-x-auto rounded-xl border border-line bg-ink p-4 font-mono text-xs text-paper/90">
{`python -m agent.main status --config configs/config.yaml > web/public/status.json
# then point the dashboard at /status.json (see web/README.md)`}
          </pre>
        </div>
      </Reveal>
    </main>
  );
}

function Card({ label, value, foot, accent }: { label: string; value: string; foot: string; accent: string }) {
  return (
    <div className="rounded-2xl border border-line bg-pane p-6">
      <p className={`font-display text-3xl font-light ${accent}`}>{value}</p>
      <p className="mt-2 text-sm text-paper">{label}</p>
      <p className="mt-1 font-mono text-[11px] text-fog">{foot}</p>
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
