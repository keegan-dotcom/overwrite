import { useState } from "react";
import { Quote, asset } from "../../data/appdata";
import { fmtUsd } from "../../lib/options";
import { clearSessionKey, getOrCreateSessionKey } from "../../lib/deriveSign";
import {
  LiveInstrument, fetchOptionChain, fetchSubaccounts, fetchTicker, matchCall,
  placeSellCall, quantize, registerSessionKey, sessionKeyActive,
} from "../../lib/deriveApi";

/**
 * Phase 1 of the retail path: place the structured covered call as a REAL
 * order on Derive testnet, entirely from the browser.
 *
 * - session key generated in-browser (localStorage), registered with ONE
 *   MetaMask transaction on Derive Chain (owner pays testnet gas)
 * - the key is admin-scoped (Derive has no trade-only scope); revocable
 *   anytime; the plain withdraw endpoint only pays back to the owner wallet
 * - orders are signed locally and sent via our CORS proxy; testnet only
 */
type Step = "idle" | "quote" | "key" | "ready" | "placing" | "done" | "error";

export function TestnetPanel({
  q, qty, ownerEoa,
}: {
  q: Quote;
  qty: number;
  ownerEoa: string;
}) {
  const a = asset(q.assetSymbol);
  const [deriveWallet, setDeriveWallet] = useState(
    () => { try { return localStorage.getItem("overwrite_derive_wallet") ?? ""; } catch { return ""; } });
  const [step, setStep] = useState<Step>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [instrument, setInstrument] = useState<LiveInstrument | null>(null);
  const [livePrice, setLivePrice] = useState<string>("");
  const [placed, setPlaced] = useState<{ order_id: string; instrument_name: string } | null>(null);
  const [err, setErr] = useState<string>("");

  const say = (s: string) => setLog((l) => [...l.slice(-8), s]);
  const leg = q.legs[0];
  const canRun = q.strategyId === "income" && leg?.side === "short" && leg.kind === "call"
    && (q.assetSymbol === "ETH" || q.assetSymbol === "BTC");

  if (!canRun) return null;

  const start = async () => {
    setErr("");
    try {
      // 1. live market data: find the real instrument nearest the intent
      setStep("quote");
      say(`fetching live ${q.assetSymbol} option chain from testnet…`);
      const chain = await fetchOptionChain(q.assetSymbol);
      const match = matchCall(chain, leg.strike, q.dte);
      if (!match) throw new Error("no live call instruments found on testnet");
      const tick = await fetchTicker(match.instrument_name);
      setInstrument(match);
      const mark = Number(tick.mark_price);
      const px = quantize(Math.max(mark, Number(tick.best_ask_price) || mark), match.tick_size);
      setLivePrice(px);
      say(`matched ${match.instrument_name} · mark ${fmtUsd(mark, 2)} → quoting ${px}`);

      // 2. session key: generate locally, register via ONE MetaMask tx
      setStep("key");
      const { pk, address } = getOrCreateSessionKey();
      if (!deriveWallet) throw new Error("enter your Derive wallet address (shown on testnet.derive.xyz)");
      try { localStorage.setItem("overwrite_derive_wallet", deriveWallet); } catch { /* noop */ }
      if (await sessionKeyActive(pk, deriveWallet)) {
        say(`session key ${address.slice(0, 8)}… already active - no wallet popup needed`);
      } else {
        say(`registering session key ${address.slice(0, 8)}… (one MetaMask tx on Derive Chain - needs a little testnet gas)`);
        say(`NO GAS on Derive Chain? Register it gaslessly instead: testnet.derive.xyz → Developers → Register Session Key → paste ${address} → then click Start again`);
        const hash = await registerSessionKey(deriveWallet, address, ownerEoa);
        say(`registration tx sent: ${hash.slice(0, 14)}… waiting for the API to see it`);
        for (let i = 0; i < 12; i++) {
          await new Promise((r) => setTimeout(r, 5000));
          if (await sessionKeyActive(pk, deriveWallet)) break;
          if (i === 11) throw new Error("session key not active yet - wait a minute and retry");
        }
        say("session key active ✓ (admin scope — revoke anytime on Derive)");
      }
      setStep("ready");
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      setStep("error");
    }
  };

  const place = async () => {
    setErr("");
    try {
      setStep("placing");
      const { pk } = getOrCreateSessionKey();
      const subs = await fetchSubaccounts(pk, deriveWallet);
      if (!subs.length) throw new Error("no subaccounts found for this wallet");
      const amount = quantize(Math.min(qty, 5), instrument!.amount_step);
      if (Number(amount) <= 0) throw new Error("amount rounds to zero for this instrument");
      say(`signing SELL ${amount} ${instrument!.instrument_name} @ ${livePrice} (post-only)…`);
      const order = await placeSellCall({
        pk, deriveWallet, subaccountId: subs[0],
        instrument: instrument!, limitPrice: livePrice, amount,
      });
      setPlaced(order);
      say(`order resting: ${order.order_id.slice(0, 12)}…`);
      setStep("done");
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      setStep("error");
    }
  };

  return (
    <div className="border-2 border-amber bg-pane">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <div className="font-mono text-[13px] uppercase tracking-[0.14em] text-amber">
            Go live on testnet · from this page
          </div>
          <div className="font-serif text-[14.5px] leading-snug text-fog">
            Real order, fake money. Session key generated in your browser, one
            MetaMask signature, then this trade rests on Derive's testnet book.
          </div>
        </div>
        {step === "idle" || step === "error" ? (
          <button onClick={start}
            className="border-2 border-paper bg-amber px-3.5 py-1.5 font-mono text-[14px] font-bold uppercase text-ink shadow-hardsm transition-transform hover:-translate-x-px hover:-translate-y-px">
            Start
          </button>
        ) : step === "ready" ? (
          <button onClick={place}
            className="border-2 border-paper bg-accent px-3.5 py-1.5 font-mono text-[14px] font-bold uppercase text-ink shadow-hardsm transition-transform hover:-translate-x-px hover:-translate-y-px">
            Place order
          </button>
        ) : (
          <span className="font-mono text-[13px] uppercase text-fog">
            {step === "done" ? "✓ resting on the book" : "working…"}
          </span>
        )}
      </div>

      <div className="space-y-2 border-t-2 border-line px-4 py-3">
        <label className="block">
          <span className="font-mono text-[13px] uppercase tracking-[0.1em] text-fog">
            Your Derive wallet — the "Wallet" address at testnet.derive.xyz → Developers (NOT "Signer"/your MetaMask address)
          </span>
          <input
            value={deriveWallet}
            onChange={(e) => setDeriveWallet(e.target.value.trim())}
            placeholder="0x…"
            className="mt-1 w-full border-2 border-line bg-ink px-3 py-1.5 font-mono text-[14.5px] text-paper placeholder:text-fog/75 focus:border-amber focus:outline-none"
          />
        </label>

        {instrument && (
          <div className="font-mono text-[13.5px] text-paper">
            live match: <span className="text-mint">{instrument.instrument_name}</span>
            {livePrice && <> · quoting <span className="text-mint">{livePrice}</span> (post-only)</>}
          </div>
        )}

        {log.length > 0 && (
          <div className="space-y-1 border border-line bg-ink px-3 py-2 font-mono text-[13px] leading-snug text-fog">
            {log.map((l, i) => <div key={i}>· {l}</div>)}
          </div>
        )}

        {placed && (
          <div className="border-2 border-mint bg-ink px-3 py-2 font-mono text-[14px] text-mint">
            ✓ REAL testnet order resting: SELL {placed.instrument_name} · id {placed.order_id.slice(0, 16)}…
            <span className="block text-[13px] text-fog">check it at testnet.derive.xyz → open orders</span>
          </div>
        )}

        {err && (
          <div className="border border-rose px-3 py-2 font-mono text-[13.5px] text-rose">
            {err}
          </div>
        )}

        <div className="flex items-center justify-between font-serif text-[13.5px] italic text-fog">
          <span>
            The key in this browser can trade this account and nothing else -
            revoke it any time at testnet.derive.xyz → Developers.
          </span>
          <button onClick={() => { clearSessionKey(); say("local session key cleared"); }}
            className="ml-3 shrink-0 border border-line px-2 py-0.5 font-mono text-[12.5px] uppercase not-italic text-fog hover:border-fog">
            forget key
          </button>
        </div>
      </div>
    </div>
  );
}
