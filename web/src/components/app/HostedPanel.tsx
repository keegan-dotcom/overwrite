import { useEffect, useState } from "react";
import { registerSessionKey } from "../../lib/deriveApi";
import { HostedStatus, hostedActivate, hostedEnroll, hostedStatus, hostedSetLive, hostedPause } from "../../lib/hosted";
import { resolveInstance } from "../../lib/instance";

/**
 * Phase 2: the hosted pilot. The backend generates + holds a trading-scoped
 * session key (encrypted at rest); the user authorizes it with ONE MetaMask
 * tx; the fleet cycles every 15 minutes - laptop closed, tab closed.
 * Testnet only. Revoke any time at testnet.derive.xyz → Developers.
 */
export function HostedPanel({ ownerEoa }: { ownerEoa: string }) {
  // private mainnet instance? swap venue links/copy and say REAL FUNDS
  const priv = resolveInstance();
  const venueUrl = priv ? "app.derive.xyz" : "testnet.derive.xyz";
  // Deep links so people don't have to hunt for these pages themselves:
  //  - session keys live on a real, linkable route (/developers)
  //  - deposit is a button on the app root (no stable standalone route), so we
  //    link the root and tell them where the Deposit button is.
  const devUrl = `https://${venueUrl}/developers`;
  const depositUrl = `https://${venueUrl}`;
  const [deriveWallet, setDeriveWallet] = useState(
    () => { try { return localStorage.getItem("overwrite_derive_wallet") ?? ""; } catch { return ""; } });
  const [st, setSt] = useState<HostedStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pollMsg, setPollMsg] = useState("");
  // set when Derive says the key is registered but the wallet has no funded
  // subaccount yet — surfaces a one-click deposit link instead of a dead-end error.
  const [needDeposit, setNeedDeposit] = useState(false);

  const refresh = async (w: string) => {
    if (/^0x[0-9a-fA-F]{40}$/.test(w)) setSt(await hostedStatus(w, ownerEoa));
  };
  useEffect(() => { void refresh(deriveWallet); /* eslint-disable-next-line */ }, []);

  const go = async () => {
    setErr(""); setNeedDeposit(false); setBusy(true);
    try {
      if (!/^0x[0-9a-fA-F]{40}$/.test(deriveWallet)) throw new Error("enter your Derive wallet address");
      if (deriveWallet.toLowerCase() === ownerEoa.toLowerCase()) {
        throw new Error(`that's your MetaMask/Rabby address (the 'Signer'). Enter the 'Wallet' address from ${venueUrl} → Developers - it's a different 0x address.`);
      }
      try { localStorage.setItem("overwrite_derive_wallet", deriveWallet); } catch { /* noop */ }
      const e = await hostedEnroll(ownerEoa, deriveWallet);
      if (e.error) throw new Error(
        e.error === "not_on_allowlist"
          ? "This wallet isn\u2019t whitelisted for mainnet trading yet. Ask Keegan to add your address."
          : e.error === "instance_full" ? "This private instance is full."
          : e.error);
      await refresh(deriveWallet); // shows the registration options block
    } catch (e2) {
      setErr(String((e2 as Error).message ?? e2));
    } finally { setBusy(false); }
  };

  /** Path A: user registered our key in Derive's UI (gasless paymaster).
   * Auto-polls for ~90s — Derive can take 30-60s to index a freshly-registered
   * key, so a single check almost always looked like "still not activated".
   * We keep checking and show live progress instead of making you click. */
  const checkActivation = async () => {
    setErr(""); setPollMsg(""); setNeedDeposit(false); setBusy(true);
    const ATTEMPTS = 18, GAP = 5000;
    let lastDetail = "";
    try {
      for (let i = 0; i < ATTEMPTS; i++) {
        setPollMsg(`Checking Derive for your key… (${i + 1}/${ATTEMPTS}) — this can take up to a minute after you register.`);
        const a = await hostedActivate(deriveWallet) as { status?: string; reason?: string; detail?: string };
        if (a.status === "active") { setPollMsg(""); await refresh(deriveWallet); return; }
        if (typeof a.detail === "string" && a.detail) lastDetail = a.detail;
        // "no subaccount" won't resolve by waiting — Derive only creates one on
        // first deposit — so surface it immediately and stop polling.
        if (a.reason === "no_subaccount") {
          setPollMsg("");
          setNeedDeposit(true);
          return;
        }
        if (i < ATTEMPTS - 1) await new Promise((r) => setTimeout(r, GAP));
      }
      // after ~90s, show the SPECIFIC reason Derive gave (the server now returns
      // an actionable detail), falling back to a checklist only if we got none.
      setPollMsg("");
      setErr(lastDetail ||
        "Still can't see your key active on Derive after ~90s. Check that you registered THIS exact key address (copy it again below) with scope admin, under the same Derive wallet above, and the tx confirmed — then activate once more.");
    } catch (e2) {
      setPollMsg("");
      setErr(String((e2 as Error).message ?? e2));
    } finally { setBusy(false); }
  };

  /** Path B: sign the registration tx here (needs gas ETH on Derive Chain). */
  const signHere = async () => {
    setErr(""); setBusy(true);
    try {
      if (!st?.session_key_address) throw new Error("enroll first");
      await registerSessionKey(deriveWallet, st.session_key_address, ownerEoa);
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const a = await hostedActivate(deriveWallet);
        if (a.status === "active") break;
        if (i === 11) throw new Error("key not active yet - wait a minute and hit refresh");
      }
      await refresh(deriveWallet);
    } catch (e2) {
      setErr(String((e2 as Error).message ?? e2));
    } finally { setBusy(false); }
  };

  const active = st?.enrolled && st.status === "active";
  // killed lives in its own column; the fleet skips killed tenants entirely, so
  // "LIVE (real orders)" must never show while killed — it isn't trading.
  const killed = (st as { kill?: boolean } | null)?.kill === true;
  const liveNow = !!st?.config?.live && !killed;

  return (
    <div className="border-2 border-mint bg-pane">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <div className={`font-mono text-[13px] uppercase tracking-[0.14em] ${priv ? "text-rose" : "text-mint"}`}>
            {priv ? "Run it 24/7 · PRIVATE MAINNET · REAL FUNDS" : "Run it 24/7 · hosted pilot (testnet)"}
          </div>
          <div className="font-serif text-[14.5px] leading-snug text-fog">
            Authorize our agent's key once via Derive's own page (scope
            <span className="font-bold"> admin</span> — Derive has no
            trade-only scope, so a key that trades needs admin). Revoke it any
            time in one click. Then the fleet manages your account every 15
            minutes, laptop closed.
            {priv && " This instance trades REAL money on Derive mainnet — allowlisted wallets only. Only fund it with what you can afford to lose; trading begins on the next 15-minute cycle after you register the key."}
          </div>
        </div>
        {active ? (
          <span className="border-2 border-mint px-3 py-1.5 font-mono text-[13px] font-bold uppercase text-mint">
            ● fleet active
          </span>
        ) : (
          <button onClick={go} disabled={busy}
            className="border-2 border-paper bg-accent px-3.5 py-1.5 font-mono text-[14px] font-bold uppercase text-ink shadow-hardsm transition-transform hover:-translate-x-px hover:-translate-y-px disabled:opacity-60">
            {busy ? "working…" : st?.enrolled ? "Finish setup" : "Go 24/7"}
          </button>
        )}
      </div>

      <div className="space-y-2 border-t-2 border-line px-4 py-3">
        <label className="block">
          <span className="font-mono text-[13px] uppercase tracking-[0.1em] text-fog">
            Your Derive wallet — the "Wallet" address at {venueUrl} → Developers (NOT "Signer"/your MetaMask address)
          </span>
          <input value={deriveWallet}
            onChange={(e) => setDeriveWallet(e.target.value.trim())}
            onBlur={() => void refresh(deriveWallet)}
            placeholder="0x…"
            className="mt-1 w-full border-2 border-line bg-ink px-3 py-1.5 font-mono text-[14.5px] text-paper placeholder:text-fog/75 focus:border-mint focus:outline-none" />
        </label>

        {/* First-timer path: no Derive account yet → send them to create one,
            then come back and paste the Wallet address. Always visible until
            they're active, since this is the #1 place people get stuck. */}
        {!active && (
          <div className="border border-line bg-ink px-3 py-2.5 font-serif text-[14.5px] leading-snug text-paper/95">
            <span className="font-bold text-paper">New to Derive — no account on the wallet you connected?</span>{" "}
            You need a Derive account first (it holds the funds the agent trades). Two minutes:{" "}
            <a href={depositUrl} target="_blank" rel="noreferrer"
               className="font-bold text-mint underline decoration-2 underline-offset-2">
              open {venueUrl} →
            </a>{" "}
            connect the <span className="font-bold">same wallet</span> you connected here, hit{" "}
            <span className="font-bold">Deposit</span> (top-right) and fund it, then open{" "}
            <a href={devUrl} target="_blank" rel="noreferrer"
               className="font-bold text-mint underline decoration-2 underline-offset-2">
              Developers →
            </a>{" "}
            and copy your <span className="font-bold">“Wallet”</span> address into the box above.
          </div>
        )}

        {st?.enrolled && st.status === "awaiting_registration" && st.session_key_address && (
          <div className="space-y-2 border-2 border-amber bg-ink px-3 py-2.5">
            <div className="font-mono text-[13px] uppercase tracking-[0.12em] text-amber">
              One step left: authorize the fleet's key
            </div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[14px] text-paper">
              <span className="break-all border border-line px-2 py-1">{st.session_key_address}</span>
              <button
                onClick={() => { void navigator.clipboard?.writeText(st.session_key_address!); }}
                className="border border-line px-2 py-1 text-[13px] uppercase text-fog hover:border-fog hover:text-paper"
              >
                copy
              </button>
            </div>
            <div className="font-serif text-[14.5px] leading-snug text-paper/95">
              <span className="font-bold text-paper">Gasless (recommended):</span>{" "}
              open the{" "}
              <a href={devUrl} target="_blank" rel="noreferrer"
                 className="text-mint underline decoration-2 underline-offset-2">
                {venueUrl}/developers
              </a>{" "}
              page → <em>Register Session Key</em> → paste the address
              above (scope: <span className="font-bold">admin</span> — required
              to place orders; Derive has no trade-only scope; revoke anytime;
              any expiry; keep the name ≤16 characters — e.g. "Overwrite Live"
              — their name field errors on longer) → Derive pays the gas. Then:
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={checkActivation} disabled={busy}
                className="border-2 border-paper bg-accent px-3 py-1.5 font-mono text-[13.5px] font-bold uppercase text-ink shadow-hardsm transition-transform hover:-translate-x-px hover:-translate-y-px disabled:opacity-60">
                {busy ? "checking…" : "I registered it → activate"}
              </button>
              <button onClick={signHere} disabled={busy}
                className="border-2 border-line px-3 py-1.5 font-mono text-[13.5px] uppercase text-fog transition-colors hover:border-fog hover:text-paper disabled:opacity-60">
                or sign here (needs gas ETH on Derive Chain)
              </button>
            </div>
            {pollMsg && (
              <div className="flex items-center gap-2 border border-mint bg-mint/10 px-2.5 py-1.5 font-mono text-[13px] text-mint">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-mint" />
                {pollMsg}
              </div>
            )}
          </div>
        )}

        {/* Unfunded account: key is registered but Derive has no subaccount yet.
            Waiting won't fix it — Derive only makes the subaccount on first
            deposit — so drop a one-click deposit link + re-check button. */}
        {needDeposit && (
          <div className="space-y-2 border-2 border-amber bg-ink px-3 py-2.5">
            <div className="font-mono text-[13px] uppercase tracking-[0.12em] text-amber">
              Almost there — deposit needed
            </div>
            <div className="font-serif text-[14.5px] leading-snug text-paper/95">
              Your key is registered, but this Derive wallet has{" "}
              <span className="font-bold">no funds yet</span> — Derive creates
              your trading subaccount the first time you deposit. Add assets, then
              hit activate again.
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={depositUrl} target="_blank" rel="noreferrer"
                 className="border-2 border-paper bg-accent px-3 py-1.5 font-mono text-[13.5px] font-bold uppercase text-ink shadow-hardsm transition-transform hover:-translate-x-px hover:-translate-y-px">
                Deposit on {venueUrl} →
              </a>
              <button onClick={checkActivation} disabled={busy}
                className="border-2 border-line px-3 py-1.5 font-mono text-[13.5px] uppercase text-fog transition-colors hover:border-fog hover:text-paper disabled:opacity-60">
                {busy ? "checking…" : "I deposited → activate"}
              </button>
            </div>
            <div className="font-serif text-[13px] italic leading-snug text-fog">
              Hit <span className="font-bold">Deposit</span> (top-right on Derive),
              fund the same wallet, then come back here.
            </div>
          </div>
        )}

        {/* owner control: flip the agent live / pause it (private instance) */}
        {priv && active && (
          <div className="flex flex-wrap items-center gap-2 border-2 border-rose bg-ink px-3 py-2.5">
            <div className="min-w-0 flex-1 font-mono text-[13px] uppercase tracking-[0.08em]">
              agent trading:{" "}
              <span className={liveNow ? "font-bold text-mint" : killed ? "text-rose" : "text-amber"}>
                {liveNow ? "● LIVE (real orders)" : killed ? "● paused (killed)" : "○ paused (dry-run)"}
              </span>
            </div>
            <button
              onClick={async () => {
                setErr(""); setBusy(true);
                try {
                  // killed is a hard stop; un-kill first (fleet ignores a killed
                  // tenant, so "go live" while killed would be a no-op).
                  if (killed) {
                    await hostedPause(deriveWallet, ownerEoa, false);
                    await refresh(deriveWallet);
                    return;
                  }
                  const next = !liveNow;
                  if (next && !window.confirm(
                    "Go LIVE with real funds on Derive mainnet?\n\nThe agent will place real orders on its next 15-minute cycle. You can pause anytime.")) {
                    return;
                  }
                  await hostedSetLive(deriveWallet, ownerEoa, next);
                  await refresh(deriveWallet);
                } catch (e2) { setErr(String((e2 as Error).message ?? e2)); }
                finally { setBusy(false); }
              }}
              disabled={busy}
              className={`border-2 px-3 py-1.5 font-mono text-[13.5px] font-bold uppercase shadow-hardsm transition-transform hover:-translate-x-px hover:-translate-y-px disabled:opacity-60 ${
                liveNow
                  ? "border-paper bg-amber text-ink"
                  : "border-paper bg-accent text-ink"
              }`}>
              {busy ? "…" : killed ? "Un-kill" : liveNow ? "Pause agent" : "Go live →"}
            </button>
          </div>
        )}

        {st?.enrolled && (
          <div className="space-y-1.5 border border-line bg-ink px-3 py-2 font-mono text-[13.5px] leading-snug">
            <div className="text-paper">
              status: <span className={active ? "text-mint" : "text-amber"}>{st.status}</span>
              {st.subaccount_id != null && <> · subaccount {st.subaccount_id}</>}
              {st.last_cycle_at && <> · last cycle {new Date(st.last_cycle_at).toLocaleTimeString()}</>}
            </div>
            {(st.premium_recent ?? 0) > 0 && (
              <div className="text-mint">premium collected (recent): ${st.premium_recent!.toFixed(2)}</div>
            )}
            {(st.cycles ?? []).slice(0, 4).map((c, i) => (
              <div key={i} className={c.ok ? "text-fog" : "text-rose"}>
                · {new Date(c.ts).toLocaleTimeString()} {c.msg}
              </div>
            ))}
            {st.last_error && <div className="text-rose">last error: {st.last_error}</div>}
            <button onClick={() => void refresh(deriveWallet)}
              className="mt-1 border border-line px-2 py-0.5 text-[12.5px] uppercase text-fog hover:border-fog">
              refresh
            </button>
          </div>
        )}

        {err && <div className="border border-rose px-3 py-2 font-mono text-[13.5px] text-rose">{err}</div>}

        <div className="font-serif text-[13.5px] italic leading-snug text-fog">
          {priv
            ? "REAL FUNDS: live orders on Derive mainnet, capped per cycle. "
            : "Testnet pilot: fake money, real orders, real 24/7 loop. "}
          Pause any time by revoking the session key on the{" "}
          <a href={devUrl} target="_blank" rel="noreferrer"
             className="not-italic underline decoration-1 underline-offset-2 hover:text-paper">
            {venueUrl}/developers
          </a>{" "}
          page.
        </div>
      </div>
    </div>
  );
}
