import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Logo } from "./Logo";

const links = [
  { href: "/#products", label: "Products" },
  { href: "/#honest", label: "The Honest Part" },
  { href: "/#safety", label: "Rails" },
  { href: "/#faq", label: "FAQ" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();
  const inApp = pathname.startsWith("/app") || pathname.startsWith("/dashboard");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b-2 transition-colors duration-200 ${
        scrolled ? "border-line bg-ink/90 backdrop-blur" : "border-line bg-ink"
      }`}
    >
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <Link to="/" aria-label="Overwrite home">
          <Logo />
        </Link>
        {!inApp && (
          <div className="hidden items-center gap-7 font-mono text-[13px] uppercase tracking-[0.12em] text-fog md:flex">
            {links.map((l) => (
              <a key={l.href} href={l.href} className="transition-colors hover:text-paper">
                {l.label}
              </a>
            ))}
          </div>
        )}
        {inApp ? (
          <Link
            to="/"
            className="border-2 border-line px-3.5 py-1.5 font-mono text-[13px] uppercase tracking-[0.08em] text-fog transition-colors hover:border-fog hover:text-paper"
          >
            ← Home
          </Link>
        ) : (
          <Link
            to="/app"
            className="border-2 border-paper bg-accent px-4 py-1.5 font-mono text-[13px] font-bold uppercase tracking-[0.08em] text-ink shadow-hardsm transition-transform hover:-translate-x-px hover:-translate-y-px"
          >
            Launch app
          </Link>
        )}
      </nav>
    </header>
  );
}
