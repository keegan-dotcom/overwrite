import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Reveal } from "./Reveal";
import { UNDERLYINGS, pct } from "../data/validation";

const TYPED = ["ETH", "BTC", "AAPL", "NVDA", "TSLA", "SPY"];

/** Typewriter: types each symbol, holds, deletes - OVR mode made literal. */
function useTypewriter(words: string[], typeMs = 110, holdMs = 1400) {
  const [text, setText] = useState("");
  useEffect(() => {
    let word = 0, len = 0, deleting = false, t: number;
    const tick = () => {
      const w = words[word];
      len += deleting ? -1 : 1;
      setText(w.slice(0, len));
      let delay = deleting ? typeMs / 2 : typeMs;
      if (!deleting && len === w.length) { deleting = true; delay = holdMs; }
      else if (deleting && len === 0) { deleting = false; word = (word + 1) % words.length; delay = 350; }
      t = window.setTimeout(tick, delay);
    };
    t = window.setTimeout(tick, 600);
    return () => window.clearTimeout(t);
  }, [words, typeMs, holdMs]);
  return text;
}

export function Hero() {
  const typed = useTypewriter(TYPED);
  const eth = UNDERLYINGS[0];

  return (
    <section className="grain border-b-2 border-paper pt-[58px]">
      <div className="mx-auto max-w-6xl px-5">
        {/* masthead strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fog">
          <span>Vol. 1 — The Covered-Call Paper</span>
          <span className="flex items-center gap-2">
            <span className="live-dot inline-block h-2 w-2 bg-market" />
            Live on Derive testnet · equities-ready
          </span>
          <span className="hidden sm:block">Est. 2026 · A Selby Studio experiment</span>
        </div>

        <div className="grid gap-10 py-14 lg:grid-cols-[1.15fr_0.85fr] lg:gap-14">
          {/* headline column */}
          <div>
            <Reveal>
              <p className="mb-6 inline-block border-2 border-paper bg-ink px-3 py-1 font-mono text-[12px] uppercase tracking-[0.2em] text-paper">
                MODE: <span className="text-accent font-bold">OVR</span> — insert is for buyers
              </p>
            </Reveal>
            <Reveal delay={1}>
              <h1 className="font-display text-[17vw] uppercase leading-[0.92] tracking-[0.01em] sm:text-7xl lg:text-[6.2rem]">
                Don't just{" "}
                <span className="strike text-fog">hold</span>
                <br />
                <span className="text-accent">overwrite</span>
                <br />
                your {typed}
                <span className="cursor-block ml-1" aria-hidden />
              </h1>
            </Reveal>
            <Reveal delay={2}>
              <p className="mt-8 max-w-xl font-serif text-xl leading-relaxed text-paper/85">
                Overwrite is an autonomous agent that sells covered calls against
                what you already hold — systematically, on-chain, on{" "}
                <a
                  href="https://derive.xyz"
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-accent decoration-2 underline-offset-4"
                >
                  Derive
                </a>
                . ETH and BTC today. Your Apple stock the day tokenized equities list.
              </p>
            </Reveal>
            <Reveal delay={3}>
              <div className="mt-9 flex flex-wrap items-center gap-4 font-mono text-sm uppercase tracking-[0.06em]">
                <a
                  href="#yield"
                  className="border-2 border-paper bg-accent px-6 py-3 font-bold text-ink shadow-hard transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5"
                >
                  See the honest numbers
                </a>
                <Link
                  to="/dashboard"
                  className="border-2 border-paper bg-ink px-6 py-3 text-paper shadow-hard transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5"
                >
                  Watch it trade →
                </Link>
              </div>
            </Reveal>
          </div>

          {/* order ticket */}
          <Reveal delay={2} className="hidden lg:block">
            <div className="regmarks ticket ticket-accent -rotate-1 p-6">
              <div className="flex items-baseline justify-between border-b-2 border-paper pb-3 font-mono text-[12px] uppercase tracking-[0.1em]">
                <span className="font-bold">Sell ticket № 0001</span>
                <span className="text-accent font-bold">gross {pct(eth.gross.d25, 0)}/yr</span>
              </div>
              <div className="flex justify-between border-b border-line py-2.5 font-mono text-[13px]">
                <span className="text-fog">UNDERLYING</span><span>ETH · covered</span>
              </div>
              <div className="flex justify-between border-b border-line py-2.5 font-mono text-[13px]">
                <span className="text-fog">DELTA / DTE</span><span>0.25Δ · 35 days</span>
              </div>
              <div className="flex justify-between border-b border-line py-2.5 font-mono text-[13px]">
                <span className="text-fog">ORDER TYPE</span><span>limit only. always.</span>
              </div>
              <PayoffSketch />
              <p className="mt-4 border-t-2 border-paper pt-3 font-serif text-[15px] leading-relaxed text-paper/80">
                Premium in every cycle. Upside capped past the strike — priced,
                not hidden. Downside stays yours.{" "}
                <a href="#honest" className="underline decoration-accent decoration-2 underline-offset-2">
                  Read why that matters.
                </a>
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function PayoffSketch() {
  return (
    <svg viewBox="0 0 320 140" className="mt-4 w-full" aria-label="Covered call payoff diagram">
      {/* axes */}
      <line x1="14" y1="116" x2="306" y2="116" stroke="#E9F2EC" strokeWidth="2" />
      <line x1="14" y1="12" x2="14" y2="116" stroke="#E9F2EC" strokeWidth="2" />
      {/* buy-and-hold */}
      <path d="M14 116 L 292 26" stroke="#8FA89C" strokeWidth="1.5" strokeDasharray="6 5" fill="none" />
      {/* covered call */}
      <path d="M14 100 L 190 40 L 306 40" stroke="#3DFFA8" strokeWidth="4" fill="none" strokeLinecap="square" />
      <line x1="190" y1="40" x2="190" y2="116" stroke="#8FA89C" strokeWidth="1" strokeDasharray="2 4" />
      <text x="190" y="132" textAnchor="middle" fill="#8FA89C" fontSize="11" fontFamily="Courier Prime">strike</text>
      <text x="290" y="20" textAnchor="end" fill="#8FA89C" fontSize="11" fontFamily="Courier Prime">hold</text>
      <text x="300" y="56" textAnchor="end" fill="#3DFFA8" fontSize="11" fontFamily="Courier Prime" fontWeight="bold">overwrite</text>
      <line x1="8" y1="100" x2="8" y2="116" stroke="#FFB84D" strokeWidth="3" />
      <text x="22" y="97" fill="#FFB84D" fontSize="11" fontFamily="Courier Prime">premium</text>
    </svg>
  );
}
