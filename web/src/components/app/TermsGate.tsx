import { useState } from "react";
import { Link } from "react-router-dom";

/**
 * The gate: nobody uses the trade desk - or connects a wallet - before
 * acknowledging the terms and risk disclosures. Bump VERSION to re-trigger
 * acceptance after material changes to /terms or /security.
 */
const VERSION = "v1-2026-08-19";
const KEY = "overwrite_terms_accepted";

export function termsAccepted(): boolean {
  try { return localStorage.getItem(KEY) === VERSION; } catch { return false; }
}

export function TermsGate({ onAccept }: { onAccept: () => void }) {
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeRisk, setAgreeRisk] = useState(false);
  const ready = agreeTerms && agreeRisk;

  const accept = () => {
    if (!ready) return;
    try { localStorage.setItem(KEY, VERSION); } catch { /* private mode */ }
    onAccept();
  };

  const box = "mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#3DFFA8]";

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-ink/95 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl border-2 border-paper bg-ink shadow-hard">
        <div className="border-b-2 border-line px-5 py-3">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-mint">
            Before you enter
          </div>
          <div className="font-display text-2xl uppercase text-paper">
            Know what this is<span className="text-accent">.</span>
          </div>
        </div>

        <div className="space-y-2.5 px-5 py-4 font-serif text-[13.5px] leading-relaxed text-paper/85">
          <p>
            <span className="font-bold text-mint">Testnet only.</span>{" "}
            Every trade here uses Derive testnet funds - fake money, real
            mechanics. Nothing on this site can touch real assets.
          </p>
          <p>
            <span className="font-bold text-amber">Experimental software.</span>{" "}
            Built rapidly, AI-assisted, bugs expected. We audited ourselves and
            published every finding - read the{" "}
            <Link to="/security" className="text-mint underline decoration-2 underline-offset-2" target="_blank">
              security review &amp; risk disclosures
            </Link>{" "}
            before deciding to trust anything here.
          </p>
          <p>
            <span className="font-bold text-paper">Not advice.</span>{" "}
            Quoted yields are estimates. Covered calls cap your upside; short
            options can lose more than the premium. Nothing here is investment,
            legal, or tax advice.
          </p>
        </div>

        <div className="space-y-3 border-t-2 border-line px-5 py-4">
          <label className="flex cursor-pointer items-start gap-2.5 font-serif text-[13px] leading-snug text-paper/90">
            <input type="checkbox" className={box} checked={agreeTerms}
              onChange={(e) => setAgreeTerms(e.target.checked)} />
            <span>
              I have read and agree to the{" "}
              <Link to="/terms" target="_blank" className="text-mint underline decoration-2 underline-offset-2">Terms of Use</Link>,
              including the release and limitation of liability, and I accept the{" "}
              <Link to="/security" target="_blank" className="text-mint underline decoration-2 underline-offset-2">published risk disclosures</Link>.
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 font-serif text-[13px] leading-snug text-paper/90">
            <input type="checkbox" className={box} checked={agreeRisk}
              onChange={(e) => setAgreeRisk(e.target.checked)} />
            <span>
              I understand this is an experimental TESTNET product, I use it
              entirely at my own risk, and I am not accessing it from a
              jurisdiction where doing so is unlawful. I acknowledge that any
              future real-money products may be unavailable to U.S. persons and
              other restricted jurisdictions.
            </span>
          </label>
          <button onClick={accept} disabled={!ready}
            className={`w-full border-2 px-4 py-2.5 font-mono text-[13px] font-bold uppercase tracking-[0.08em] transition-transform ${
              ready
                ? "border-paper bg-accent text-ink shadow-hardsm hover:-translate-x-px hover:-translate-y-px"
                : "border-line text-fog"
            }`}>
            {ready ? "Enter the trade desk →" : "Check both boxes to continue"}
          </button>
          <p className="text-center font-mono text-[9.5px] uppercase tracking-[0.1em] text-fog">
            demo pricing · derive testnet · your keys stay yours
          </p>
        </div>
      </div>
    </div>
  );
}
