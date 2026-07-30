import { useState } from "react";
import { Reveal } from "./Reveal";
import { SectionHead } from "./SectionHead";

const faqs = [
  {
    q: "Is the 10% yield real?",
    a: "As gross option premium: yes, and then some — ETH quotes ~30%/yr and NVDA-class names ~27% at standard settings; SPY is the marginal case at ~10.7%. As guaranteed total return: no such thing exists. Premium is income you collect for selling upside; our validation shows exactly what that costs in each market regime.",
  },
  {
    q: "Can the agent lose my keys or withdraw my funds?",
    a: "No. It trades through a Derive session key scoped to trading only. Withdrawal rights stay with your wallet. The vault contracts are a separate, optional layer — and they're unaudited, so they hold no external deposits today.",
  },
  {
    q: "What happens in a crash?",
    a: "You still own the asset, so you take the drawdown — premium softens it by roughly its annual yield, it does not hedge it. The agent stops adding risk at a 40% margin-usage ceiling and pauses new sells 15% below the equity high-water mark.",
  },
  {
    q: "When do the stock vaults go live?",
    a: "The day Derive lists tokenized-stock options. Derive's founder has outlined an RWA expansion covering equities, and its first RWA market (tokenized gold) shipped in July 2026. AAPL/NVDA/TSLA/SPY parameters are already tuned behind one config flag. Until listing, we don't quote a date, because nobody has confirmed one.",
  },
  {
    q: "Can US users deposit?",
    a: "Tokenized stocks are currently unavailable to US persons across every major issuer, and pooled vault products raise their own US regulatory questions. Running the open-source agent on your own funds is a different matter — read the docs, know your jurisdiction, talk to your own counsel. None of this is investment advice.",
  },
  {
    q: "Why Derive?",
    a: "It's ~90% of on-chain options volume with a real orderbook, portfolio margin, cash-settled European options, and native support for posting the underlying as collateral — true covered calls, not synthetic approximations. And it pays builders: Overwrite earns via Builder Codes on its own flow, not by touching your principal.",
  },
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="border-t-2 border-ink bg-cream py-24">
      <div className="mx-auto max-w-3xl px-5">
        <SectionHead
          no="06"
          kicker="Correspondence"
          title={<>Questions people actually ask<span className="text-accent">.</span></>}
        />
        <div className="mt-10 border-2 border-ink bg-paper shadow-hard">
          {faqs.map((f, i) => (
            <div key={f.q} className={i > 0 ? "border-t-2 border-ink" : ""}>
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="flex w-full items-center justify-between gap-6 px-6 py-4 text-left transition-colors hover:bg-cream"
                aria-expanded={open === i}
              >
                <span className="font-serif text-lg font-semibold">{f.q}</span>
                <span
                  className={`font-mono text-xl font-bold text-accent transition-transform ${
                    open === i ? "rotate-45" : ""
                  }`}
                >
                  +
                </span>
              </button>
              <div
                className="grid transition-all duration-300 ease-out"
                style={{ gridTemplateRows: open === i ? "1fr" : "0fr" }}
              >
                <div className="overflow-hidden">
                  <p className="px-6 pb-6 font-serif text-[15px] leading-relaxed text-ink/75">{f.a}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
