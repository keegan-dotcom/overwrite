import { Reveal } from "./Reveal";
import { SectionHead } from "./SectionHead";

const rails = [
  {
    title: "Covered. Always.",
    body: "The engine can't sell more calls than assets held — enforced in the strategy and re-checked by an independent risk gate before every order.",
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
    body: "touch data/KILL stops everything, instantly. A separate PAUSE file stops new risk while letting unwinds through.",
  },
  {
    title: "Non-custodial",
    body: "The agent trades through a session key scoped to trading. Withdrawal rights never leave your wallet. There is no pool to drain.",
  },
  {
    title: "Adversarially audited",
    body: "An independent audit hit the agent before any live order: 3 critical + 5 high findings, all fixed, 18 attack-tests added. Vault contracts remain unaudited — and say so, loudly.",
  },
];

export function Safety() {
  return (
    <section id="safety" className="mx-auto max-w-6xl px-5 py-24">
      <SectionHead
        no="03"
        kicker="Security"
        title={<>Non-custodial by design<span className="text-accent">.</span></>}
      />
      <div className="mt-12 grid gap-0 border-2 border-paper md:grid-cols-2 lg:grid-cols-3">
        {rails.map((r, i) => (
          <Reveal key={r.title} delay={(i % 3) as 0 | 1 | 2} className="h-full">
            <div className={`h-full border-line p-6 transition-colors hover:bg-cream ${i % 3 !== 2 ? "lg:border-r-2" : ""} ${i < 3 ? "lg:border-b-2" : ""} ${i % 2 === 0 ? "max-lg:md:border-r-2" : ""} max-lg:border-b-2 lg:max-lg:border-b-0`}>
              <p className="font-mono text-[13px] font-bold uppercase tracking-[0.16em] text-accent">
                Control {String(i + 1).padStart(2, "0")}
              </p>
              <h3 className="mt-2 font-display text-xl uppercase">{r.title}</h3>
              <p className="mt-3 font-serif text-[16.5px] leading-relaxed text-paper/75">{r.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
