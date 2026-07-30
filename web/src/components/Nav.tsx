import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Logo } from "./Logo";

const links = [
  { href: "/#yield", label: "Yield" },
  { href: "/#how", label: "How it works" },
  { href: "/#vaults", label: "Vaults" },
  { href: "/#safety", label: "Safety" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "backdrop-blur-md bg-ink/80 border-b border-line"
          : "bg-transparent border-b border-transparent"
      }`}
    >
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
        <Link to="/" aria-label="Overwrite home">
          <Logo />
        </Link>
        <div className="hidden items-center gap-7 text-sm text-fog md:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="transition-colors hover:text-paper">
              {l.label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
              pathname === "/dashboard"
                ? "border-mint text-mint"
                : "border-line text-fog hover:border-mint hover:text-mint"
            }`}
          >
            Dashboard
          </Link>
          <a
            href="https://testnet.derive.xyz"
            target="_blank"
            rel="noreferrer"
            className="hidden rounded-full bg-mint px-4 py-1.5 text-sm font-semibold text-ink transition-transform hover:scale-[1.03] sm:block"
          >
            Run the agent
          </a>
        </div>
      </nav>
    </header>
  );
}
