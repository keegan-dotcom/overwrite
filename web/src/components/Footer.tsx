import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="border-t-2 border-paper bg-ink text-paper">
      <div className="mx-auto max-w-6xl px-5 pt-14">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <Logo dark />
            <p className="mt-4 font-serif text-[16.5px] leading-relaxed text-dfog">
              The covered-call layer for the tokenized-stock era. Built on
              Derive. Agent open-source, rails paranoid, numbers published.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-10 font-mono text-[14.5px] sm:grid-cols-3">
            <div>
              <p className="border-b border-darkline pb-2 text-[13px] uppercase tracking-[0.2em] text-dfog">Product</p>
              <ul className="mt-3 space-y-2">
                <li><a className="hover:text-accent" href="/app">The app</a></li>
                <li><a className="hover:text-accent" href="/#products">Products</a></li>
                <li><a className="hover:text-accent" href="/#waitlist">Hosted waitlist</a></li>
              </ul>
            </div>
            <div>
              <p className="border-b border-darkline pb-2 text-[13px] uppercase tracking-[0.2em] text-dfog">Read</p>
              <ul className="mt-3 space-y-2">
                <li><a className="hover:text-accent" href="/#honest">Expected returns</a></li>
                <li><a className="hover:text-accent" href="/#how">How it works</a></li>
                <li><a className="hover:text-accent" href="/security">Security review · audit results</a></li>
                <li><a className="hover:text-accent" href="/terms">Terms of use</a></li>
              </ul>
            </div>
            <div>
              <p className="border-b border-darkline pb-2 text-[13px] uppercase tracking-[0.2em] text-dfog">Elsewhere</p>
              <ul className="mt-3 space-y-2">
                <li><a className="hover:text-accent" href="https://derive.xyz" target="_blank" rel="noreferrer">Derive ↗</a></li>
                <li><a className="hover:text-accent" href="https://docs.derive.xyz" target="_blank" rel="noreferrer">Derive docs ↗</a></li>
                <li><a className="hover:text-accent" href="https://github.com/keegan-dotcom/overwrite" target="_blank" rel="noreferrer">GitHub ↗</a></li>
              </ul>
            </div>
          </div>
        </div>

        <p className="mt-12 border-t border-darkline pt-6 font-mono text-[13px] leading-relaxed text-dfog">
          © {new Date().getFullYear()} Overwrite · A Selby Studio experiment.
          Nothing here is investment, legal, or tax advice. Covered calls cap
          upside and retain downside; premium yield is not total return. Smart
          contracts unaudited. Testnet software — do not deposit funds you
          cannot lose. Tokenized equities are currently unavailable to US persons.
        </p>

        {/* giant masthead sign-off */}
        <div className="mt-8 overflow-hidden" aria-hidden>
          <p className="translate-y-[0.28em] whitespace-nowrap text-center font-display text-[18vw] uppercase leading-none text-paper/10 md:text-[13rem]">
            Overwrite
          </p>
        </div>
      </div>
    </footer>
  );
}
