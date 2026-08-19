import { Link } from "react-router-dom";

/**
 * The security review, published in full. Findings from the audit performed
 * by Claude (Fable 5) on 2026-08-19, commissioned by Selby Studio - including
 * what was found, what was fixed, and what risk remains. Transparency over
 * polish: users deserve the same view of this system that we have.
 */

type Finding = {
  sev: "HIGH" | "MEDIUM" | "LOW" | "INFO";
  title: string;
  detail: string;
  status: "FIXED" | "DISCLOSED" | "BY DESIGN";
  fix: string;
};

const FINDINGS: Finding[] = [
  {
    sev: "HIGH",
    title: "Fleet API secret was committed to the public GitHub repo",
    detail:
      "The shared secret that authorizes the 15-minute trading cycle was hardcoded in the open-source backend code. Anyone reading the repo could have triggered extra fleet cycles (extra testnet quotes - never withdrawals or transfers, which the system cannot do).",
    status: "FIXED",
    fix: "Secret rotated and moved to a deny-all database row that never appears in code or the repo; the endpoint now compares it in constant time. The old secret is dead.",
  },
  {
    sev: "MEDIUM",
    title: "Account lookup could be shadowed by a spam enrollment",
    detail:
      "The Console looks up your hosted account by the wallet you connect. An attacker could have enrolled a junk record against your address so your Console showed their record instead of yours (display-only - no funds or keys were reachable).",
    status: "FIXED",
    fix: "Lookups now resolve your ACTIVE account first, enrollments are capped at 3 per address, and the endpoint is rate-limited.",
  },
  {
    sev: "MEDIUM",
    title: "Self-hosted agent could be pointed at mainnet by a config edit",
    detail:
      "The open-source python agent supports Derive mainnet behind a config flag. A typo, a copied config, or a malicious edit could have silently aimed it at real funds.",
    status: "FIXED",
    fix: "Hard gate added: mainnet now refuses to start unless the operator also sets OVERWRITE_ALLOW_MAINNET=1 in their environment. Testnet is the default and the only silent option.",
  },
  {
    sev: "MEDIUM",
    title: "Hosted session keys depend on our database's security",
    detail:
      "For the 24/7 hosted pilot we generate a session key per user, AES-GCM-encrypted at rest with a key derived from the database's own service credential. If our Supabase project were fully compromised, an attacker could decrypt tenant session keys and trade (not withdraw) on those testnet accounts.",
    status: "DISCLOSED",
    fix: "Accepted for the testnet pilot and disclosed here. Before any real-money version: dedicated KMS/HSM custody, per-tenant key derivation, and a third-party audit. You can revoke our key at any time at testnet.derive.xyz → Developers.",
  },
  {
    sev: "LOW",
    title: "\"Cannot withdraw\" depends on the scope YOU pick at registration",
    detail:
      "You authorize our agent's key in Derive's own interface and choose its scope there. Our instructions say scope \"account\" (trading only). If you choose \"admin\" instead, the key has broader account permissions than we need or want.",
    status: "DISCLOSED",
    fix: "Instructions updated to explicitly say scope: account. We will verify scope enforcement end-to-end with the Derive team before any mainnet release.",
  },
  {
    sev: "LOW",
    title: "Hosted account status is publicly readable by address",
    detail:
      "The Console's data endpoint is read-only but unauthenticated: anyone who knows a wallet address can view that testnet account's positions, orders, and activity. A deliberate transparency choice for the pilot.",
    status: "BY DESIGN",
    fix: "Will be gated behind a wallet-signature login before any real-money version.",
  },
  {
    sev: "LOW",
    title: "In-browser orders keep a session key in your browser's storage",
    detail:
      "The optional \"place it from this browser\" flow generates a testnet session key in your browser and keeps it in localStorage. Malicious browser extensions or an XSS flaw could read it. We found no XSS vectors (no innerHTML/eval; React escaping throughout), and the key can only trade one testnet subaccount.",
    status: "DISCLOSED",
    fix: "Testnet-only feature. A real-money version would use short-lived keys and stricter storage.",
  },
  {
    sev: "INFO",
    title: "Everything else checked came back clean",
    detail:
      "All trading endpoints are hardcoded to Derive TESTNET (api-demo / chain 901); the only transaction the site ever asks you to sign is session-key registration on that test chain; the site never asks for seed phrases or private keys; wallet connect is read-only; database tables are deny-all (service-role only, verified with Supabase's security advisor); the AI chat endpoint is rate-limited, schema-constrained, and does no math or trading itself; the API proxy is allowlisted to specific testnet methods only.",
    status: "BY DESIGN",
    fix: "—",
  },
];

const SEV_COLOR: Record<Finding["sev"], string> = {
  HIGH: "text-rose border-rose",
  MEDIUM: "text-amber border-amber",
  LOW: "text-paper border-line",
  INFO: "text-mint border-mint",
};

export function Security() {
  return (
    <main className="bg-ink pt-[58px]">
      <div className="mx-auto max-w-4xl px-5 py-16">
        <div className="rule-double pt-5">
          <div className="flex items-baseline gap-4 font-mono text-[12px] uppercase tracking-[0.2em] text-fog">
            <span className="font-bold text-mint">Security</span>
            <span>Published in full · updated 2026-08-19</span>
          </div>
          <h1 className="mt-4 font-display text-4xl uppercase leading-[0.98] text-paper sm:text-5xl">
            Security review &amp; risk disclosures<span className="text-accent">.</span>
          </h1>
        </div>

        <div className="mt-8 space-y-4 font-serif text-[15.5px] leading-relaxed text-paper/85">
          <p>
            This page is the unedited result of a security review of the entire
            Overwrite stack — website, APIs, database, hosted trading fleet,
            and the open-source agent — performed on August 19, 2026 by{" "}
            <span className="font-semibold text-paper">Claude (Fable 5)</span>,
            the AI system that also builds this product, commissioned by Selby
            Studio. We publish everything: what was found, what was fixed the
            same day, and what risk remains. An automated review is not a
            substitute for a professional third-party audit; one is planned
            before anything here ever touches real money.
          </p>
          <p className="border-2 border-mint bg-pane px-4 py-3 font-mono text-[13px] uppercase tracking-[0.04em] text-mint">
            The single most important fact: Overwrite runs on Derive TESTNET
            only. Test funds, fake money, real orders. No component of this
            system can custody, withdraw, or transfer real assets.
          </p>
        </div>

        <h2 className="mt-12 border-b-2 border-line pb-2 font-display text-2xl uppercase text-paper">
          Findings
        </h2>
        <div className="mt-4 space-y-3">
          {FINDINGS.map((f, i) => (
            <div key={i} className="border-2 border-line bg-pane">
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
                <span className={`border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${SEV_COLOR[f.sev]}`}>
                  {f.sev}
                </span>
                <span className="min-w-0 flex-1 font-mono text-[12.5px] font-bold uppercase tracking-[0.02em] text-paper">
                  {f.title}
                </span>
                <span className={`font-mono text-[10.5px] font-bold uppercase ${
                  f.status === "FIXED" ? "text-mint" : "text-amber"
                }`}>
                  {f.status}
                </span>
              </div>
              <div className="space-y-2 px-4 py-3 font-serif text-[13.5px] leading-relaxed text-paper/85">
                <p>{f.detail}</p>
                {f.fix !== "—" && (
                  <p className="text-fog">
                    <span className="font-mono text-[10.5px] uppercase text-mint">Resolution → </span>
                    {f.fix}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        <h2 className="mt-12 border-b-2 border-line pb-2 font-display text-2xl uppercase text-paper">
          What this system can and cannot do
        </h2>
        <div className="mt-4 grid gap-0 border-2 border-line sm:grid-cols-2">
          <div className="border-line px-4 py-3 sm:border-r">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-mint">It can</div>
            <ul className="space-y-1.5 font-serif text-[13.5px] leading-snug text-paper/85">
              <li>→ Read balances of a wallet you connect (no signatures)</li>
              <li>→ Quote and place limit orders on Derive TESTNET, inside your own subaccount, under a session key you authorize</li>
              <li>→ Cancel and replace its own orders</li>
            </ul>
          </div>
          <div className="px-4 py-3">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-rose">It cannot</div>
            <ul className="space-y-1.5 font-serif text-[13.5px] leading-snug text-paper/85">
              <li>→ Touch mainnet or any real asset (endpoints are hardcoded to testnet; the agent has a mainnet hard-gate)</li>
              <li>→ Withdraw or transfer funds anywhere (register the key with scope "account")</li>
              <li>→ See your seed phrase or private keys — it never asks, and you should never share them with anyone</li>
              <li>→ Keep trading after you revoke the key at testnet.derive.xyz → Developers</li>
            </ul>
          </div>
        </div>

        <h2 className="mt-12 border-b-2 border-line pb-2 font-display text-2xl uppercase text-paper">
          Standing risk disclosures
        </h2>
        <div className="mt-4 space-y-3 font-serif text-[14.5px] leading-relaxed text-paper/85">
          <p>
            Even on testnet, this is experimental software built rapidly by a
            solo studio with AI assistance. Bugs, downtime, incorrect quotes,
            and lost testnet balances are all possible. The strategies shown
            model real options mechanics: covered calls cap upside, short
            options can lose more than the premium collected, and quoted yields
            are estimates, never guarantees. Nothing on this site is
            investment, legal, or tax advice. If a future version ever touches
            real funds, it will ship with a professional third-party audit, key
            custody in dedicated hardware, and its own updated version of this
            page — and you should still only risk what you can afford to lose.
          </p>
          <p className="font-mono text-[12px] uppercase tracking-[0.06em] text-fog">
            Questions or a vulnerability to report → open an issue on{" "}
            <a href="https://github.com/keegan-dotcom/overwrite" target="_blank" rel="noreferrer" className="text-mint underline">GitHub</a>.
            Full terms → <Link to="/terms" className="text-mint underline">Terms of Use</Link>.
          </p>
        </div>
      </div>
    </main>
  );
}
