import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-6xl px-5 py-14">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-fog">
              The covered-call layer for the tokenized-stock era. Built on
              Derive. Agent open-source, rails paranoid, numbers published.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-10 text-sm sm:grid-cols-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-fog">Product</p>
              <ul className="mt-3 space-y-2 text-paper/90">
                <li><a className="hover:text-mint" href="/#yield">Yield explorer</a></li>
                <li><a className="hover:text-mint" href="/#vaults">Vaults</a></li>
                <li><a className="hover:text-mint" href="/dashboard">Dashboard</a></li>
              </ul>
            </div>
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-fog">Read</p>
              <ul className="mt-3 space-y-2 text-paper/90">
                <li><a className="hover:text-mint" href="/#honest">The honest part</a></li>
                <li><a className="hover:text-mint" href="/#safety">Safety rails</a></li>
                <li><a className="hover:text-mint" href="/#how">How it works</a></li>
              </ul>
            </div>
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-fog">Elsewhere</p>
              <ul className="mt-3 space-y-2 text-paper/90">
                <li><a className="hover:text-mint" href="https://derive.xyz" target="_blank" rel="noreferrer">Derive ↗</a></li>
                <li><a className="hover:text-mint" href="https://docs.derive.xyz" target="_blank" rel="noreferrer">Derive docs ↗</a></li>
                <li><a className="hover:text-mint" href="https://github.com" target="_blank" rel="noreferrer">GitHub ↗</a></li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-12 border-t border-line pt-6">
          <p className="font-mono text-[11px] leading-relaxed text-fog">
            © {new Date().getFullYear()} Overwrite · A Selby Studio experiment.
            Nothing here is investment, legal, or tax advice. Covered calls cap
            upside and retain downside; premium yield is not total return.
            Smart contracts unaudited. Testnet software — do not deposit funds
            you cannot lose. Tokenized equities are currently unavailable to US
            persons.
          </p>
        </div>
      </div>
    </footer>
  );
}
