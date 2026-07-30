import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Reveal } from "./Reveal";
import { UNDERLYINGS, pct } from "../data/validation";

/** Parallax orbs follow scroll + mouse subtly. */
function useParallax() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let mx = 0, my = 0, sy = 0;
    const update = () => {
      raf = 0;
      el.querySelectorAll<HTMLElement>("[data-depth]").forEach((orb) => {
        const d = parseFloat(orb.dataset.depth || "0.1");
        orb.style.transform = `translate3d(${mx * 40 * d}px, ${sy * -120 * d + my * 30 * d}px, 0)`;
      });
    };
    const onMouse = (e: MouseEvent) => {
      mx = e.clientX / window.innerWidth - 0.5;
      my = e.clientY / window.innerHeight - 0.5;
      if (!raf) raf = requestAnimationFrame(update);
    };
    const onScroll = () => {
      sy = Math.min(1, window.scrollY / 900);
      if (!raf) raf = requestAnimationFrame(update);
    };
    window.addEventListener("mousemove", onMouse, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return ref;
}

export function Hero() {
  const ref = useParallax();
  const eth = UNDERLYINGS[0];

  return (
    <section
      ref={ref}
      className="relative flex min-h-[92vh] items-center overflow-hidden pt-24"
    >
      <div className="grid-backdrop absolute inset-0" aria-hidden />
      <div
        className="orb h-[420px] w-[420px] bg-mint/15 left-[-120px] top-[10%]"
        data-depth="0.25"
        aria-hidden
      />
      <div
        className="orb h-[520px] w-[520px] bg-mintdim/10 right-[-160px] top-[30%]"
        data-depth="0.45"
        aria-hidden
      />
      <div
        className="orb h-[260px] w-[260px] bg-amber/10 left-[45%] bottom-[-80px]"
        data-depth="0.7"
        aria-hidden
      />

      <div className="relative mx-auto grid max-w-6xl gap-14 px-5 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
        <div>
          <Reveal>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-pane px-3.5 py-1.5 text-xs tracking-wide text-fog">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-mint" />
              LIVE ON DERIVE TESTNET · EQUITIES-READY FOR V3
            </p>
          </Reveal>
          <Reveal delay={1}>
            <h1 className="font-display text-5xl font-light leading-[1.04] tracking-tight sm:text-6xl lg:text-[4.6rem]">
              Idle assets are{" "}
              <em className="not-italic text-mint">unsold options.</em>
            </h1>
          </Reveal>
          <Reveal delay={2}>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-fog">
              Overwrite is an autonomous agent that sells covered calls against
              what you already hold — systematically, on-chain, on{" "}
              <a
                href="https://derive.xyz"
                target="_blank"
                rel="noreferrer"
                className="text-paper underline decoration-mint/40 underline-offset-4 hover:decoration-mint"
              >
                Derive
              </a>
              . ETH and BTC today. Your Apple stock the day tokenized equities
              list.
            </p>
          </Reveal>
          <Reveal delay={3}>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <a
                href="#yield"
                className="rounded-full bg-mint px-6 py-3 font-semibold text-ink transition-transform hover:scale-[1.03]"
              >
                See the honest numbers
              </a>
              <Link
                to="/dashboard"
                className="rounded-full border border-line px-6 py-3 text-paper transition-colors hover:border-mint hover:text-mint"
              >
                Watch it trade →
              </Link>
            </div>
          </Reveal>
        </div>

        {/* payoff card */}
        <Reveal delay={2} className="hidden lg:block">
          <div className="rounded-2xl border border-line bg-pane/80 p-6 backdrop-blur">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-xs text-fog">ETH · 0.25Δ · 35 DTE</span>
              <span className="font-mono text-xs text-mint">gross {pct(eth.gross.d25, 0)}/yr</span>
            </div>
            <PayoffSketch />
            <p className="mt-4 text-sm leading-relaxed text-fog">
              Premium in every cycle. Upside capped past the strike — priced,
              not hidden. Downside stays yours.{" "}
              <a href="#honest" className="text-paper underline decoration-mint/40 underline-offset-4">
                Read why that matters.
              </a>
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function PayoffSketch() {
  return (
    <svg viewBox="0 0 320 150" className="mt-4 w-full" aria-label="Covered call payoff diagram">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3DFFA8" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#3DFFA8" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* axis */}
      <line x1="16" y1="120" x2="304" y2="120" stroke="#1E2A26" strokeWidth="1.5" />
      <line x1="16" y1="16" x2="16" y2="120" stroke="#1E2A26" strokeWidth="1.5" />
      {/* buy-and-hold */}
      <path d="M16 120 L 290 30" stroke="#8FA89C" strokeWidth="1.5" strokeDasharray="5 5" fill="none" />
      {/* covered call: shifted up by premium, capped at strike */}
      <path d="M16 104 L 190 44 L 304 44" stroke="#3DFFA8" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M16 104 L 190 44 L 304 44 L 304 120 L 16 120 Z" fill="url(#fade)" />
      {/* strike marker */}
      <line x1="190" y1="44" x2="190" y2="120" stroke="#3DFFA8" strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />
      <text x="190" y="138" textAnchor="middle" fill="#8FA89C" fontSize="10" fontFamily="IBM Plex Mono">strike</text>
      <text x="288" y="26" textAnchor="end" fill="#8FA89C" fontSize="10" fontFamily="IBM Plex Mono">hold</text>
      <text x="296" y="60" textAnchor="end" fill="#3DFFA8" fontSize="10" fontFamily="IBM Plex Mono">overwrite</text>
      {/* premium bracket */}
      <line x1="10" y1="104" x2="10" y2="120" stroke="#FFB84D" strokeWidth="2" />
      <text x="24" y="100" fill="#FFB84D" fontSize="10" fontFamily="IBM Plex Mono">premium</text>
    </svg>
  );
}
