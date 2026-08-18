import { Link } from "react-router-dom";
import { Reveal } from "./Reveal";
import { SectionHead } from "./SectionHead";

/**
 * The product story in one section: three ways to run Overwrite, one
 * obvious default. Replaces the former Vaults / Works-with-Claude /
 * scattered-CTA sections.
 */
const CARDS = [
  {
    kicker: "For everyone · live now",
    title: "The App",
    body: "Connect a wallet, say what you want in plain English — or pick a strategy off the shelf — and get the trade structured with every tradeoff disclosed. Payoff charts, honest math, real testnet orders from your browser. No greeks, no terminal.",
    cta: { label: "Launch the app →", to: "/app", primary: true },
    foot: "Wallet connect · intent chat · 6 strategies · Derive testnet",
  },
  {
    kicker: "For self-custody · open source",
    title: "The Agent",
    body: "The same engine, MIT-licensed, running on your machine with your keys. Install it as a Claude plugin and manage it by talking — or run the CLI raw. Dry-run by default, preflight-gated go-live, kill switch. Audit it with your own AI before trusting it.",
    cta: { label: "GitHub + install →", href: "https://github.com/keegan-dotcom/overwrite" },
    foot: "Claude plugin · MCP · Python CLI · 116 tests",
  },
  {
    kicker: "For hands-off · testnet pilot live",
    title: "Hosted",
    body: "The agent runs 24/7 without your laptop: one isolated account per user, a session key scoped so it can trade but never withdraw, cycles every 15 minutes. Live on testnet now - one signature in the app turns it on. Mainnet joins via the waitlist.",
    cta: { label: "Try the pilot →", to: "/app" },
    foot: "Per-user isolation · revoke any time · mainnet waitlist open",
  },
];

export function Products() {
  return (
    <section id="products" className="mx-auto max-w-6xl px-5 py-24">
      <SectionHead
        no="01"
        kicker="The products"
        title={<>One engine, three ways in<span className="text-accent">.</span></>}
      />
      <div className="mt-12 grid gap-6 lg:grid-cols-3">
        {CARDS.map((c, i) => (
          <Reveal key={c.title} delay={i as 0 | 1 | 2} className="h-full">
            <div className={`flex h-full flex-col border-2 p-6 ${i === 0 ? "border-accent shadow-hard" : "border-paper"}`}>
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-accent">
                {c.kicker}
              </p>
              <h3 className="mt-2 font-display text-3xl uppercase">{c.title}</h3>
              <p className="mt-4 font-serif text-[15px] leading-relaxed text-paper/80">{c.body}</p>
              <div className="mt-auto pt-6">
                {"to" in c.cta ? (
                  <Link
                    to={c.cta.to!}
                    className={`inline-block border-2 px-5 py-2.5 font-mono text-[13px] font-bold uppercase tracking-[0.06em] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 ${
                      c.cta.primary ? "border-paper bg-accent text-ink shadow-hardsm" : "border-paper text-paper"
                    }`}
                  >
                    {c.cta.label}
                  </Link>
                ) : (
                  <a
                    href={c.cta.href}
                    target={c.cta.href!.startsWith("http") ? "_blank" : undefined}
                    rel="noreferrer"
                    className="inline-block border-2 border-paper px-5 py-2.5 font-mono text-[13px] uppercase tracking-[0.06em] text-paper transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5"
                  >
                    {c.cta.label}
                  </a>
                )}
                <p className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.1em] text-fog">{c.foot}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
