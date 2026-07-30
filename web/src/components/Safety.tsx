import { Reveal } from "./Reveal";

const rails = [
  {
    title: "Covered. Always.",
    body: "The engine can't sell more calls than assets held — the invariant is enforced in the strategy and re-checked by an independent risk gate before every order.",
  },
  {
    title: "Fails closed",
    body: "Any error evaluating any risk rule vetoes the order. Stale quote? Veto. Weird margin read? Veto. Silence is never consent.",
  },
  {
    title: "Limit orders only",
    body: "No market orders exist in the codebase. Prices ladder from mid toward the touch, sanity-checked against mark on every step.",
  },
  {
    title: "Kill switch",
    body: "touch data/KILL stops everything, instantly, including the flatten command. A separate PAUSE file stops new risk while letting unwinds through.",
  },
  {
    title: "Non-custodial by construction",
    body: "The agent trades through a session key scoped to trading. Withdrawal rights never leave your wallet. There is no pool to drain.",
  },
  {
    title: "Adversarially audited",
    body: "An independent audit pass hit the agent before any live order: 3 critical + 5 high findings, all fixed, 18 attack-tests added. Vault contracts remain unaudited — and say so, loudly.",
  },
];

export function Safety() {
  return (
    <section id="safety" className="border-y border-line bg-pane/40 py-28">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-mint">Rails</p>
          <h2 className="mt-3 max-w-2xl font-display text-4xl font-light tracking-tight sm:text-5xl">
            Paranoia, productized<span className="text-mint">.</span>
          </h2>
        </Reveal>
        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {rails.map((r, i) => (
            <Reveal key={r.title} delay={(i % 3) as 0 | 1 | 2}>
              <div className="h-full rounded-2xl border border-line bg-ink p-6 transition-colors hover:border-mint/40">
                <h3 className="font-display text-xl">{r.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-fog">{r.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
