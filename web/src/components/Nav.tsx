import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Logo } from "./Logo";

const links = [
  { href: "/#yield", label: "The Dial" },
  { href: "/#how", label: "The Loop" },
  { href: "/#vaults", label: "Vaults" },
  { href: "/#safety", label: "Rails" },
  { href: "/#claude", label: "Claude" },
  { href: "/#waitlist", label: "Hosted" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();
  const onDash = pathname === "/dashboard";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b-2 transition-colors duration-200 ${
        onDash
          ? "border-darkline bg-ink"
          : scrolled
          ? "border-line bg-ink/90 backdrop-blur"
          : "border-line bg-ink"
      }`}
    >
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <Link to="/" aria-label="Overwrite home">
          <Logo dark={onDash} />
        </Link>
        <div
          className={`hidden items-center gap-7 font-mono text-[13px] uppercase tracking-[0.12em] md:flex ${
            onDash ? "text-dfog" : "text-fog"
          }`}
        >
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={`transition-colors ${onDash ? "hover:text-paper" : "hover:text-paper"}`}
            >
              {l.label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-3 font-mono text-[13px] uppercase tracking-[0.08em]">
          <Link
            to="/app"
            className={`border-2 px-3.5 py-1.5 transition-colors ${
              pathname === "/app"
                ? "border-mint text-mint"
                : "border-paper text-paper hover:border-mint hover:text-mint"
            }`}
          >
            App
          </Link>
          <Link
            to="/dashboard"
            className={`border-2 px-3.5 py-1.5 transition-colors ${
              onDash
                ? "border-mint text-mint"
                : "border-paper text-paper hover:border-mint hover:text-mint"
            }`}
          >
            Console
          </Link>
          <a
            href="https://testnet.derive.xyz"
            target="_blank"
            rel="noreferrer"
            className="hidden border-2 border-paper bg-accent px-3.5 py-1.5 font-bold text-ink shadow-hardsm transition-transform hover:-translate-x-px hover:-translate-y-px sm:block"
          >
            Run the agent
          </a>
        </div>
      </nav>
    </header>
  );
}
