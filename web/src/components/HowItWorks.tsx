import { Reveal } from "./Reveal";

const steps = [
  {
    n: "01",
    title: "Hold",
    body: "Your asset sits as collateral in a Derive subaccount you control. The agent holds a session key scoped to trading only — it can never withdraw.",
    mono: "session_key.scope = trade",
  },
  {
    n: "02",
    title: "Write",
    body: "Every cycle it sells calls at your target delta, 25–60 days out — only when the book is liquid, the quote is fresh, and premium clears your yield floor.",
    mono: "sell 0.25Δ · 35 DTE · limit-only",
  },
  {
    n: "03",
    title: "Manage",
    body: "Take-profit at 75% decay. Roll at 21 days. If a call goes deep in the money it rolls only for a credit that also cuts risk — never a debit, never a doubling-down.",
    mono: "roll iff credit ∧ Δ↓0.10",
  },
  {
    n: "04",
    title: "Settle & repeat",
    body: "Options are European and cash-settled — no assignment surprises. Premium lands in USDC, capacity frees up, the loop continues.",
    mono: "premium_in += fill × size",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="border-y border-line bg-pane/40 py-28">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-mint">The loop</p>
          <h2 className="mt-3 font-display text-4xl font-light tracking-tight sm:text-5xl">
            A patient seller that never sleeps
            <span className="text-mint">.</span>
          </h2>
        </Reveal>
        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-4">
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={(i % 4) as 0 | 1 | 2 | 3}>
              <div className="group h-full bg-ink p-7 transition-colors hover:bg-pane">
                <p className="font-mono text-sm text-mint">{s.n}</p>
                <h3 className="mt-3 font-display text-2xl font-light">{s.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-fog">{s.body}</p>
                <p className="mt-5 rounded-lg border border-line bg-ink px-3 py-2 font-mono text-[11px] text-mintdim transition-colors group-hover:border-mint/30">
                  {s.mono}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
