import { Reveal } from "./Reveal";
import { SectionHead } from "./SectionHead";

const steps = [
  {
    n: "A",
    title: "Hold",
    body: "Your asset sits as collateral in a Derive subaccount you control. The agent holds a session key scoped to trading only — it can never withdraw.",
    mono: "session_key.scope = trade",
  },
  {
    n: "B",
    title: "Write",
    body: "Every cycle it sells calls at your target delta, 25–60 days out — only when the book is liquid, the quote is fresh, and premium clears your yield floor.",
    mono: "sell 0.25Δ · 35 DTE · limit-only",
  },
  {
    n: "C",
    title: "Manage",
    body: "Take-profit at 75% decay. Roll at 21 days. Deep in-the-money calls roll only for a credit that also cuts risk — never a debit, never doubling down.",
    mono: "roll iff credit ∧ Δ↓0.10",
  },
  {
    n: "D",
    title: "Settle & repeat",
    body: "Options are European and cash-settled — no assignment surprises. Premium lands in USDC, capacity frees up, the loop continues.",
    mono: "premium_in += fill × size",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="border-y-2 border-paper bg-pane py-24">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHead
          no="02"
          kicker="The loop"
          title={<>A patient seller that never sleeps<span className="text-accent">.</span></>}
        />
        <div className="mt-12 grid border-2 border-paper bg-darkline gap-px md:grid-cols-4">
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={(i % 4) as 0 | 1 | 2 | 3} className="h-full">
              <div className="group flex h-full flex-col bg-ink p-6 transition-colors hover:bg-cream">
                <p className="font-display text-5xl text-line transition-colors group-hover:text-accent">{s.n}</p>
                <h3 className="mt-3 font-display text-2xl uppercase">{s.title}</h3>
                <p className="mt-3 flex-1 font-serif text-[15px] leading-relaxed text-paper/75">{s.body}</p>
                <p className="mt-5 border-t border-line pt-3 font-mono text-[12px] text-mint">
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
