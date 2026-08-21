import { Link } from "react-router-dom";

/**
 * Terms of Use. Plain-English where possible, formal where it must be.
 * Drafted 2026-08-19. NOTE TO OPERATOR: have a licensed attorney review
 * before any real-money launch; liability releases have limits that vary
 * by jurisdiction and cannot waive claims that law makes non-waivable.
 */

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "1 · What Overwrite is (and is not)",
    body: [
      "Overwrite (overwrite.pro) is experimental, open-source software operated by Selby Studio (\"we\", \"us\") that demonstrates automated options strategies on the Derive TESTNET. Testnet assets have no monetary value. The service does not custody assets, does not execute real-money transactions, and does not offer securities, derivatives, investment products, or investment advice of any kind.",
      "The strategies, yields, and prices shown are simulations or testnet quotes. They are estimates produced by software (including AI systems) and may be wrong, stale, or unavailable at any time.",
    ],
  },
  {
    title: "2 · Acceptance",
    body: [
      "By checking the acceptance box, connecting a wallet, or otherwise using the app, you agree to these Terms and to the risk disclosures on our Security page, which are incorporated here by reference. If you do not agree, do not use the service.",
    ],
  },
  {
    title: "3 · Eligibility",
    body: [
      "You must be at least 18 years old and legally able to enter into these Terms. You represent that your use of the service is lawful where you live. If any future version of the service involves real-money products, access may be restricted by jurisdiction (including for U.S. persons) and additional eligibility attestations will apply; the attestation you make at the app gate is made in anticipation of those restrictions.",
    ],
  },
  {
    title: "4 · Non-custodial; your keys, your responsibility",
    body: [
      "You control your wallet and your Derive account at all times. Any session key you authorize is registered by you, in Derive's own interface or with your own signature, and you can revoke it at any time at testnet.derive.xyz → Developers. We never ask for, receive, or store your seed phrase or wallet private keys. You are solely responsible for the security of your devices, wallet, and keys.",
    ],
  },
  {
    title: "5 · Assumption of risk",
    body: [
      "You understand and accept all risks of using experimental blockchain software, including but not limited to: software bugs and vulnerabilities (ours, Derive's, or third parties'); smart-contract failures; oracle and pricing errors; session-key compromise; database or infrastructure compromise; AI-generated code or content errors; network failures; and the total loss of any testnet or (in any future version) real assets. Options strategies carry inherent market risk: covered calls cap upside, short options can lose more than the premium received, and no yield is guaranteed.",
      "You accept these risks voluntarily and agree that you use the service entirely at your own risk.",
    ],
  },
  {
    title: "6 · No advice; no fiduciary duty",
    body: [
      "Nothing on this site — including AI chat responses, strategy suggestions, quoted yields, and documentation — is investment, financial, legal, or tax advice, or a recommendation to buy or sell any asset. We are not your broker, advisor, or fiduciary. Consult qualified professionals before making financial decisions.",
    ],
  },
  {
    title: "7 · Service provided \"as is\"",
    body: [
      "THE SERVICE IS PROVIDED \"AS IS\" AND \"AS AVAILABLE\", WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, ACCURACY, OR UNINTERRUPTED OPERATION. We may modify, suspend, or discontinue any part of the service at any time without notice.",
    ],
  },
  {
    title: "8 · Release and limitation of liability",
    body: [
      "TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW: (a) you release Selby Studio, its owner, contributors, and service providers (the \"Released Parties\") from all claims, demands, and damages of every kind arising out of or related to your use of the service, including any loss of assets, data, or profits, whether caused by negligence, security incident, software error, AI error, or otherwise; (b) the Released Parties' total aggregate liability for any claim shall not exceed one hundred U.S. dollars (US$100) or the amount you paid us to use the service (currently zero), whichever is greater; and (c) in no event shall the Released Parties be liable for indirect, incidental, special, consequential, or punitive damages.",
      "Some jurisdictions do not allow certain waivers or limitations; in those jurisdictions, the above applies to the fullest extent the law allows. Nothing in these Terms waives rights that cannot lawfully be waived.",
    ],
  },
  {
    title: "9 · Indemnification",
    body: [
      "You agree to indemnify and hold the Released Parties harmless from claims, damages, and expenses (including reasonable attorneys' fees) arising from your use of the service, your violation of these Terms, or your violation of any law or third-party right.",
    ],
  },
  {
    title: "10 · Open source; third parties",
    body: [
      "The code is published at github.com/keegan-dotcom/overwrite under its stated license. Derive, wallet providers, and other third-party services are independent of us; your use of them is governed by their own terms, and we are not responsible for their conduct, uptime, or security.",
    ],
  },
  {
    title: "11 · Changes",
    body: [
      "We may update these Terms at any time by posting the revised version here with a new date. Continued use after changes constitutes acceptance. Material changes will re-trigger the acceptance gate in the app.",
    ],
  },
  {
    title: "12 · Governing law & disputes",
    body: [
      "These Terms are governed by the laws of the State of South Dakota, USA, without regard to conflict-of-law rules. Any dispute that cannot be resolved informally shall be brought exclusively in the state or federal courts located in South Dakota, and you consent to their jurisdiction. YOU AND WE EACH WAIVE ANY RIGHT TO A JURY TRIAL AND TO PARTICIPATE IN A CLASS ACTION, to the extent permitted by law.",
    ],
  },
];

export function Terms() {
  return (
    <main className="bg-ink pt-[58px]">
      <div className="mx-auto max-w-3xl px-5 py-16">
        <div className="rule-double pt-5">
          <div className="flex items-baseline gap-4 font-mono text-[14px] uppercase tracking-[0.2em] text-fog">
            <span className="font-bold text-mint">Legal</span>
            <span>Effective 2026-08-19</span>
          </div>
          <h1 className="mt-4 font-display text-4xl uppercase leading-[0.98] text-paper sm:text-5xl">
            Terms of use<span className="text-accent">.</span>
          </h1>
          <p className="mt-4 font-serif text-[16.5px] leading-relaxed text-paper/95">
            The short version: this is a testnet experiment with fake money.
            Use it at your own risk, keep your keys safe, expect bugs, and
            don't treat anything here as financial advice. The long version
            follows, and the{" "}
            <Link to="/security" className="text-mint underline">security review</Link>{" "}
            discloses exactly what we found when we audited ourselves.
          </p>
        </div>

        <div className="mt-10 space-y-8">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h2 className="border-b border-line pb-1.5 font-mono text-[14.5px] font-bold uppercase tracking-[0.08em] text-paper">
                {s.title}
              </h2>
              {s.body.map((p, i) => (
                <p key={i} className="mt-2.5 font-serif text-[15.5px] leading-relaxed text-paper/95">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>

        <p className="mt-12 border-t-2 border-line pt-4 font-mono text-[13px] uppercase leading-relaxed tracking-[0.06em] text-fog">
          Selby Studio · overwrite.pro · contact via{" "}
          <a href="https://github.com/keegan-dotcom/overwrite" target="_blank" rel="noreferrer" className="text-mint underline">GitHub</a>
        </p>
      </div>
    </main>
  );
}
