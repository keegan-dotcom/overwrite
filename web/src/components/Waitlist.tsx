import { useState } from "react";
import { Reveal } from "./Reveal";
import { SectionHead } from "./SectionHead";

/**
 * Hosted-version waitlist.
 * Set FORM_ENDPOINT to a Formspree (or similar) endpoint to collect emails:
 *   1. formspree.io -> new form -> copy the https://formspree.io/f/xxxx URL
 *   2. paste it below, push - done. Until then, submissions open a
 *      pre-filled email instead, so no signup is ever lost.
 */
const FORM_ENDPOINT = "";  // e.g. "https://formspree.io/f/abcdwxyz"
const FALLBACK_MAILTO = "keeganrayselby@gmail.com";

export function Waitlist() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) return;
    if (!FORM_ENDPOINT) {
      window.location.href =
        `mailto:${FALLBACK_MAILTO}?subject=${encodeURIComponent("Overwrite hosted waitlist")}` +
        `&body=${encodeURIComponent(`Add me to the hosted waitlist: ${email}`)}`;
      setState("done");
      return;
    }
    setState("sending");
    try {
      const r = await fetch(FORM_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, source: "overwrite-hosted-waitlist" }),
      });
      setState(r.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <section id="waitlist" className="border-t-2 border-paper bg-ink py-24">
      <div className="mx-auto max-w-3xl px-5">
        <SectionHead
          no="04"
          kicker="Coming next"
          title={<>Don't want to run a terminal? <span className="text-accent">Join the hosted list.</span></>}
        >
          Same agent, same rails, zero setup: connect a trading-scoped session
          key (it can never withdraw — custody stays with your wallet), pick
          your delta, watch the premium. We run the loop.
        </SectionHead>

        <Reveal delay={1}>
          {state === "done" ? (
            <p className="mt-10 border-2 border-mint bg-mint/10 px-6 py-5 font-mono text-sm text-mint">
              ✓ You're on the list. We'll write when the hosted beta opens.
            </p>
          ) : (
            <form onSubmit={submit} className="mt-10 flex flex-col gap-3 sm:flex-row">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="flex-1 border-2 border-paper bg-pane px-5 py-3.5 font-mono text-sm text-paper placeholder:text-fog focus:border-mint focus:outline-none"
                aria-label="Email address"
              />
              <button
                type="submit"
                disabled={state === "sending"}
                className="border-2 border-paper bg-accent px-7 py-3.5 font-mono text-sm font-bold uppercase tracking-[0.06em] text-ink shadow-hard transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 disabled:opacity-60"
              >
                {state === "sending" ? "..." : "Join waitlist"}
              </button>
            </form>
          )}
          {state === "error" && (
            <p className="mt-3 font-mono text-xs text-rose">
              Something broke — email {FALLBACK_MAILTO} instead.
            </p>
          )}
          <p className="mt-4 font-mono text-[11px] leading-relaxed text-fog">
            Non-custodial by construction · kill switch always yours · not
            investment advice · not available to US persons for tokenized
            equities.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
