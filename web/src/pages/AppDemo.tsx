import { useCallback, useEffect, useRef, useState } from "react";
import { asset, strategy, Quote, DEMO_PORTFOLIO, roundStrike, ASSETS, STRATEGIES, IntentParams, Holding } from "../data/appdata";
import { connectWallet, hasWallet, shortAddr, WalletState } from "../lib/wallet";
import { callPrice, strikeForYield, fmtUsd, fmtPct } from "../lib/options";
import { parseIntent } from "../lib/intent";
import { planAndValidate, describePlan } from "../lib/strategy/planner";
import { refreshLivePrices } from "../lib/prices";
import { RunItYourself } from "../components/app/RunItYourself";
import { TestnetPanel } from "../components/app/TestnetPanel";
import { HostedPanel } from "../components/app/HostedPanel";
import { Console } from "../components/app/Console";
import { TermsGate, termsAccepted } from "../components/app/TermsGate";
import { hostedStatus, HostedStatus, hostedDeployPlan } from "../lib/hosted";
import { resolveInstance, getNetwork, setNetwork } from "../lib/instance";
import { AgentBar } from "../components/app/AgentBar";
import { VENUES, VenueMode } from "../data/venues";
import { StrategyRail } from "../components/app/StrategyRail";
import { TradeTicket } from "../components/app/TradeTicket";
import { Modal } from "../components/app/Modal";
import { IntentChat } from "../components/app/IntentChat";
import { AgentFeed } from "../components/app/AgentFeed";
import type { ChatMsg, FeedEvent, Position, Suggestion } from "../components/app/types";

const now = () =>
  new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

const qtyIn = (list: Holding[], sym: string) => list.find((h) => h.symbol === sym)?.qty ?? 1;

/* Preference memory: the agent remembers your risk defaults across visits.
 * Explicit prompt values always win; saved defaults fill the gaps. */
type Prefs = { stopLossPct?: number; dte?: number };
const PREFS_KEY = "overwrite_defaults";
const loadPrefs = (): Prefs => {
  try { return JSON.parse(window.localStorage.getItem(PREFS_KEY) || "{}"); }
  catch { return {}; }
};
const savePrefs = (p: Prefs) => {
  try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
};
const clearPrefs = () => {
  try { window.localStorage.removeItem(PREFS_KEY); } catch { /* private mode */ }
};
const prefsNote = (p: Prefs): string | null => {
  const bits = [
    p.stopLossPct != null ? `${(p.stopLossPct * 100).toFixed(0)}% auto-close` : null,
    p.dte != null ? `${p.dte}d horizon` : null,
  ].filter(Boolean);
  return bits.length ? bits.join(" · ") : null;
};

type IncomingIntent = {
  symbol: string;
  strategyId: string;
  params: Partial<IntentParams>;
  understood: string[];
  reply?: string;
};

/**
 * Ask the LLM seat (/api/intent) to parse the message. Returns null when the
 * endpoint is unconfigured, rate-limited, slow (>9s) or returns anything that
 * doesn't validate - the caller then falls back to the offline parser, so the
 * demo always works.
 */
async function fetchLlmIntent(message: string, lastIntent: unknown): Promise<IncomingIntent | null> {
  try {
    const ctrl = new AbortController();
    const to = window.setTimeout(() => ctrl.abort(), 9000);
    const r = await fetch("/api/intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, lastIntent }),
      signal: ctrl.signal,
    });
    window.clearTimeout(to);
    if (!r.ok || !(r.headers.get("content-type") || "").includes("application/json")) return null;
    const j = await r.json();
    if (!j || typeof j !== "object") return null;
    if (!ASSETS.some((a) => a.symbol === j.symbol)) return null;
    if (!STRATEGIES.some((s) => s.id === j.strategyId)) return null;
    const p = (j.params && typeof j.params === "object" ? j.params : {}) as Partial<IntentParams>;
    return {
      symbol: j.symbol,
      strategyId: j.strategyId,
      params: p,
      understood: Array.isArray(j.understood) ? j.understood.filter((x: unknown) => typeof x === "string").slice(0, 6) : [],
      reply: typeof j.reply === "string" ? j.reply : undefined,
    };
  } catch {
    return null;
  }
}

const HELLO: ChatMsg = {
  role: "agent",
  text: "I manage options strategies from your own isolated vault. Tell me what you want in plain English - an income target, a price you'd happily sell at, a floor you won't go below - and I'll structure the trade, show you every tradeoff, and run it until you say otherwise.",
};

export function AppDemo() {
  const [selected, setSelected] = useState("BTC");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [ticket, setTicket] = useState<Quote | null>(null);
  const [ticketQty, setTicketQty] = useState(1);
  const [deployedTicket, setDeployedTicket] = useState(false);
  const [positions, setPositions] = useState<Position[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([HELLO]);
  const [thinking, setThinking] = useState(false);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  // the last chat-built plan that PASSED the coherence validator (deployable)
  const [pendingPlan, setPendingPlan] = useState<import("../lib/strategy/ir").StrategyPlan | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [, setPricesTick] = useState(0); // bump to re-render when live prices land
  const timers = useRef<number[]>([]);
  const ticketRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(1);
  const lastIntent = useRef<{ symbol: string; strategyId: string; params: Record<string, unknown> } | null>(null);
  const prefsRef = useRef<Prefs>({});
  const [defaultsNote, setDefaultsNote] = useState<string | null>(null);
  const [venueMode, setVenueMode] = useState<VenueMode>("v2");
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [gated, setGated] = useState(() => !termsAccepted());
  // your Derive testnet trading account (collateral the agent actually trades),
  // found via the connected signing wallet - kept separate from on-chain balances
  const [deriveAcct, setDeriveAcct] = useState<{ sub: number | null; holdings: Holding[]; usdc: number } | null>(null);
  const [hostedSt, setHostedSt] = useState<HostedStatus | null>(null);
  const onMainnet = getNetwork() === "mainnet";
  const [view, setView] = useState<"trade" | "console">("trade");
  // Connected: show YOUR portfolio - real balances where we can read them,
  // zeros for the rest, so it's obvious the screen is no longer demo data.
  // What the tickets size to: the Derive trading account when one exists
  // (that's what the agent trades), else the connected wallet, else demo.
  const activeHoldings = deriveAcct ? deriveAcct.holdings : wallet?.holdings ?? null;
  const portfolio: Holding[] = activeHoldings
    ? [
        ...DEMO_PORTFOLIO.map((d) => ({
          symbol: d.symbol,
          qty: activeHoldings.find((h) => h.symbol === d.symbol)?.qty ?? 0,
        })),
        // any KNOWN asset held that isn't in the standard rail list still
        // shows (unknown collateral symbols are skipped - no pricing for them)
        ...activeHoldings.filter(
          (h) =>
            h.qty > 0 &&
            !DEMO_PORTFOLIO.some((d) => d.symbol === h.symbol) &&
            ASSETS.some((a) => a.symbol === h.symbol),
        ),
      ]
    : DEMO_PORTFOLIO;
  const portfolioRef = useRef<Holding[]>(DEMO_PORTFOLIO);
  portfolioRef.current = portfolio;

  useEffect(() => {
    prefsRef.current = loadPrefs();
    setDefaultsNote(prefsNote(prefsRef.current));
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const pushFeed = (kind: FeedEvent["kind"], text: string) =>
    setFeed((f) => [...f, { ts: now(), kind, text }].slice(-40));

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const structure = useCallback((sym: string, stratId: string, params: Partial<IntentParams> = {}, mode: "shelf" | "chat" | "silent" = "shelf") => {
    const a = asset(sym);
    const s = strategy(stratId);
    // saved defaults fill gaps; anything explicit wins
    const merged = { ...prefsRef.current, ...params };
    const q = s.quote(a, merged);
    const held = qtyIn(portfolioRef.current, sym);
    const qty = held > 0 ? held : 1; // zero balance -> preview sized to 1 unit
    setSelected(sym);
    setPickedId(stratId);
    setTicket(q);
    setTicketQty(qty);
    setDeployedTicket(false);
    if (mode === "shelf") {
      setMessages((m) => [
        ...m,
        {
          role: "agent",
          text: `Structured ${s.name} on your ${qty.toLocaleString()} ${sym}. ${q.headline} The full ticket - payoff, tradeoffs, what I'll manage - is below the strategies. Tweak it here: ${q.capPrice != null ? `"make the cap $${Math.round(q.capPrice * 1.05).toLocaleString()}" or ` : ""}"add a 15% stop" - or just say what you'd change.`,
        },
      ]);
    }
    if (mode !== "silent") {
      // scroll ticket into view on small screens
      later(60, () => ticketRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    }
    return q;
  }, []);

  // the page opens composed: default strategy on the default asset
  useEffect(() => {
    structure("BTC", "income", {}, "silent");
  }, [structure]);

  const onSelectAsset = useCallback((sym: string) => {
    structure(sym, pickedId ?? "income", {}, "silent");
  }, [structure, pickedId]);

  const onConnect = useCallback(async () => {
    setConnecting("reading your wallet balances…");
    let w: WalletState | null = null;
    try { w = await connectWallet(); } catch { /* user rejected */ }
    if (!w) { setConnecting(null); return; }

    // your tradable assets live INSIDE your Derive testnet account as
    // collateral, not in the EOA - if this address owns (or signs for) a
    // hosted account, show THOSE balances in the vault
    setConnecting(onMainnet ? "checking your Derive mainnet account…" : "checking your Derive testnet account…");
    let acct: { sub: number | null; holdings: Holding[]; usdc: number } | null = null;
    try {
      const st = await hostedStatus(w.address, w.address);
      setHostedSt(st.enrolled ? st : null);
      if (st.enrolled && (st.collaterals?.length ?? 0) > 0) {
        const round4 = (x: number) => Math.round(x * 10_000) / 10_000;
        acct = {
          sub: st.subaccount_id ?? null,
          holdings: st.collaterals!
            .filter((c) => c.asset !== "USDC" && c.amount > 0)
            .map((c) => ({ symbol: c.asset, qty: round4(c.amount) })),
          usdc: Math.round((st.collaterals!.find((c) => c.asset === "USDC")?.amount ?? 0) * 100) / 100,
        };
      }
    } catch { /* no hosted account or endpoint hiccup - keep on-chain view */ }

    setConnecting("structuring suggested trades for your portfolio…");
    setDeriveAcct(acct);
    setWallet(w);
    const tradable = acct ? acct.holdings : w.holdings;
    const owned = tradable.filter((h) => h.qty > 0);
    const seen = owned.map((h) => `${h.qty.toLocaleString()} ${h.symbol}`).join(", ");
    const usdcSeen = acct ? acct.usdc : w.usdc;
    const best = owned
      .filter((h) => ASSETS.some((a) => a.symbol === h.symbol) && asset(h.symbol).live)
      .sort((a, b) => b.qty * asset(b.symbol).spot - a.qty * asset(a.symbol).spot)[0];
    setMessages((m) => [
      ...m,
      {
        role: "agent",
        text: owned.length || (acct && usdcSeen > 0)
          ? `Connected ${shortAddr(w!.address)} (read-only).${
              acct
                ? ` Found your Derive ${onMainnet ? "mainnet" : "testnet"} account${acct.sub != null ? ` (subaccount ${acct.sub})` : ""} - the vault shows what's in it${seen ? `: ${seen}` : ""}${usdcSeen > 0 ? `${seen ? " and" : ":"} $${usdcSeen.toLocaleString()} USDC` : ""}. That's what the agent trades; your wallet's own balances are listed separately below it.`
                : ` I can see ${seen}${usdcSeen > 0 ? ` and $${usdcSeen.toLocaleString()} USDC` : ""}.`
            }${
              best
                ? ` Your largest holding is ${best.symbol}, so I've structured a suggested trade on it - the ticket is live. Approve & deploy, or tell me what you'd rather do.`
                : " Every ticket is now sized to what you actually hold."
            }`
          : `Connected ${shortAddr(w!.address)} (read-only), but your balances read zero on this ${w!.chainId === 1 ? "wallet" : "network (switch to Ethereum mainnet for token balances)"} and I didn't find a Derive ${onMainnet ? "mainnet" : "testnet"} account for this address - your portfolio shows the zeros, and tickets are previews sized to 1 unit until you hold something.`,
      },
    ]);
  }, []);

  // once a wallet connects: re-quote on the largest live holding (or keep the
  // current asset, resized), then clear the connect progress strip
  useEffect(() => {
    if (!wallet) return;
    const tradable = deriveAcct ? deriveAcct.holdings : wallet.holdings;
    const best = tradable
      .filter((h) => h.qty > 0 && ASSETS.some((a) => a.symbol === h.symbol) && asset(h.symbol).live)
      .sort((a, b) => b.qty * asset(b.symbol).spot - a.qty * asset(a.symbol).spot)[0];
    structure(best ? best.symbol : selected, pickedId ?? "income", {}, "silent");
    later(700, () => setConnecting(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);

  // re-pull the hosted agent's live state (status, open orders, live flag) -
  // on demand after a control action, and on a 20s poll while connected
  const refreshHosted = useCallback(async () => {
    if (!wallet) return;
    try {
      const st = await hostedStatus(wallet.address, wallet.address);
      setHostedSt(st.enrolled ? st : null);
    } catch { /* endpoint hiccup - keep last view */ }
  }, [wallet]);

  useEffect(() => {
    if (!wallet || !onMainnet) return;
    const id = window.setInterval(() => void refreshHosted(), 20_000);
    return () => window.clearInterval(id);
  }, [wallet, onMainnet, refreshHosted]);

  // live prices: patch the baked demo prices with Derive's real index prices so
  // the agent never suggests trades off stale numbers. Refreshes on mount + 60s.
  useEffect(() => {
    const pull = () => void refreshLivePrices().then((u) => {
      if (Object.keys(u).length) setPricesTick((n) => n + 1);
    });
    pull();
    const id = window.setInterval(pull, 60_000);
    return () => window.clearInterval(id);
  }, []);

  /** Structure the intent, run the honesty check, post the agent's reply. */
  const applyIntent = useCallback((p: IncomingIntent) => {
    lastIntent.current = { symbol: p.symbol, strategyId: p.strategyId, params: p.params as Record<string, unknown> };

    // preference memory: risk limits you state once become your defaults
    const remembered: string[] = [];
    if (p.params.stopLossPct != null && p.params.stopLossPct !== prefsRef.current.stopLossPct) {
      prefsRef.current = { ...prefsRef.current, stopLossPct: p.params.stopLossPct };
      remembered.push(`auto-close ${(p.params.stopLossPct * 100).toFixed(0)}%`);
    }
    if (p.params.dte != null && p.params.dte !== prefsRef.current.dte) {
      prefsRef.current = { ...prefsRef.current, dte: p.params.dte };
      remembered.push(`${p.params.dte}d horizon`);
    }
    if (remembered.length) {
      savePrefs(prefsRef.current);
      setDefaultsNote(prefsNote(prefsRef.current));
    }

    const s = strategy(p.strategyId);
    const q = structure(p.symbol, p.strategyId, p.params, "chat");
    const a = asset(p.symbol);

    // honesty check (always in code, never delegated to the model):
    // does the requested cap actually pay the requested yield?
    let conflict = "";
    const wantY = p.params.targetYieldAnnual;
    if (p.strategyId === "income" && wantY != null && p.params.capTarget != null &&
        q.incomeAnnualPct < wantY * 0.8) {
      const kAlt = strikeForYield(a.spot, wantY, a.iv, q.dte / 365);
      conflict = kAlt
        ? ` One thing you should know: a cap at ${fmtUsd(p.params.capTarget)} only pays ~${fmtPct(q.incomeAnnualPct, 1)}/yr. To actually earn ${fmtPct(wantY, 0)}, the cap has to come down to about ${fmtUsd(roundStrike(kAlt, a))}. Your call - say "hit my yield target" and I'll restructure.`
        : ` One thing you should know: ${fmtPct(wantY, 0)}/yr isn't reachable on ${p.symbol} at today's volatility, even selling at-the-money. The ticket shows what your cap really pays.`;
    }

    // coherence layer: build the structured plan (the IR the executor runs)
    // and validate it. This is what refuses trades that don't achieve the goal
    // and confirms the ones that do - always in code, never left to the model.
    const { plan, result } = planAndValidate({
      symbol: p.symbol, strategyId: p.strategyId, params: p.params, understood: p.understood,
    });
    setPendingPlan(result.ok ? plan : null);
    const coherence = result.ok
      ? `✓ coherent · ${describePlan(plan)}`
      : `✕ won't deploy: ${result.errors.map((e) => e.message).join(" ")}`;
    const warnLines = result.warnings.map((w) => `note: ${w.message}`);

    const lead = p.reply
      ? p.reply
      : `Here's what I built - ${s.name} (${s.proName}) on your ${qtyIn(portfolioRef.current, p.symbol).toLocaleString()} ${p.symbol}.`;
    const tail = result.ok
      ? (a.live ? "Approve the ticket and I take over the management loop." : "This asset lists on Derive soon - the ticket is a preview you can pre-approve.")
      : "I won't put this on as-is - tell me the outcome you're after and I'll structure one that actually gets there.";
    setMessages((m) => [
      ...m,
      {
        role: "agent",
        text: `${lead} ${q.headline}${conflict} ${tail}`,
        bullets: [
          ...p.understood,
          coherence,
          ...warnLines,
          ...(remembered.length ? [`Saved as your default: ${remembered.join(", ")} (say "clear my defaults" to reset)`] : []),
        ],
      },
    ]);
  }, [structure]);

  const onSend = useCallback((text: string) => {
    setMessages((m) => [...m, { role: "user", text }]);
    setThinking(true);
    void (async () => {
      // preference memory reset - handled locally, no model needed
      if (/clear (my )?defaults|forget (my )?defaults|reset (my )?defaults/i.test(text)) {
        prefsRef.current = {};
        clearPrefs();
        setDefaultsNote(null);
        setThinking(false);
        setMessages((m) => [
          ...m,
          { role: "agent", text: "Done - defaults cleared. New trades go back to standard settings until you state new limits." },
        ]);
        return;
      }

      // LLM seat first (real intent understanding when ANTHROPIC_API_KEY is set)
      const llm = await fetchLlmIntent(text, lastIntent.current);
      if (llm) {
        setThinking(false);
        applyIntent(llm);
        return;
      }

      // offline fallback: deterministic parser (the demo always works)
      // follow-up special-case: "hit my yield target" → drop the cap
      if (/hit my yield|yield target|restructure/i.test(text) && lastIntent.current?.params["targetYieldAnnual"] != null) {
        const li = lastIntent.current;
        const params = { ...li.params, capTarget: null };
        lastIntent.current = { ...li, params };
        const q2 = structure(li.symbol, li.strategyId, params, "chat");
        setThinking(false);
        setMessages((m) => [
          ...m,
          {
            role: "agent",
            text: `Restructured for the yield. ${q2.headline} The lower cap is what pays for it - the ticket has the updated payoff.`,
          },
        ]);
        return;
      }
      const p = parseIntent(text.toLowerCase());
      setThinking(false);
      applyIntent({ symbol: p.symbol, strategyId: p.strategyId, params: p.params, understood: p.understood });
    })();
  }, [structure, applyIntent]);

  // deploy the last coherent chat plan to the hosted mainnet agent (dry-run)
  const deployPlan = useCallback(async () => {
    if (!pendingPlan || !wallet) return;
    let dw = hostedSt?.derive_wallet ?? "";
    if (!dw) { try { dw = localStorage.getItem("overwrite_derive_wallet") ?? ""; } catch { /* noop */ } }
    if (!/^0x[0-9a-fA-F]{40}$/.test(dw)) {
      setMessages((m) => [...m, { role: "agent", text: "Set up your mainnet agent first (connect + enroll), then I can deploy this plan to it." }]);
      return;
    }
    setDeploying(true);
    try {
      await hostedDeployPlan(dw, wallet.address, pendingPlan);
      setMessages((m) => [...m, {
        role: "agent",
        text: `Deployed "${pendingPlan.label}" to your agent in DRY-RUN — it logs exactly what it would trade each 15-minute cycle, places nothing. Review it in the Console, then flip it live from the agent bar when you're happy.`,
      }]);
      setPendingPlan(null);
      await refreshHosted();
    } catch (e) {
      setMessages((m) => [...m, { role: "agent", text: `Couldn't deploy: ${String((e as Error).message ?? e)}` }]);
    } finally { setDeploying(false); }
  }, [pendingPlan, wallet, hostedSt, refreshHosted]);

  const onDeploy = useCallback(() => {
    if (!ticket) return;
    const a = asset(ticket.assetSymbol);
    const qty = ticketQty;
    setDeployedTicket(true);
    const pos: Position = {
      id: idRef.current++,
      assetSymbol: ticket.assetSymbol,
      quote: ticket,
      qty,
      openedAt: now(),
    };
    setPositions((ps) => [...ps, pos]);
    setMessages((m) => [
      ...m,
      {
        role: "agent",
        text: `Deployed from your vault. I'm running it now - take-profits, rolls, and market reactions are automatic, and I'll ping you before anything changes shape. Prefer your own machine? A "Run it yourself" panel just appeared under the ticket - download the generated config and run the open-source agent from your terminal.`,
      },
    ]);

    const leg = ticket.legs[0];
    pushFeed("action", `deploy: ${leg.side === "short" ? "SELL" : "BUY"} ${ticket.assetSymbol} ${fmtUsd(leg.strike)} ${leg.kind.toUpperCase()} ×${(leg.qty * qty).toLocaleString()} → post-only at mark`);
    later(2200, () => pushFeed("info", `filled · ${ticket.incomeMonthly >= 0 ? "premium banked" : "cost paid"}: ${fmtUsd(Math.abs(ticket.incomeMonthly * qty), 0)}`));
    VENUES[venueMode].settleStages.forEach((stage, i) =>
      later(3200 + i * 1100, () => pushFeed("info", stage)));
    later(5800, () => pushFeed("info", `monitoring · IV ${fmtPct(a.iv, 0)} · margin use 8% · all rails green`));

    // market-reaction suggestion
    later(9000, () => {
      if (ticket.capPrice != null) {
        const newCap = roundStrike(ticket.capPrice * 1.045, a);
        const extra = (callPrice(a.spot * 1.03, ticket.capPrice, a.iv + 0.05, ticket.dte / 365) -
                       callPrice(a.spot * 1.03, newCap, a.iv + 0.05, ticket.dte / 365)) * qty;
        pushFeed("suggest", `IV jumped +5pts on ${ticket.assetSymbol} - restructure available`);
        setSuggestion({
          id: pos.id,
          title: `${ticket.assetSymbol} rallying with rich vol - roll your cap up to ${fmtUsd(newCap)}?`,
          detail: `Volatility spiked, so calls pay more. Rolling the cap from ${fmtUsd(ticket.capPrice)} to ${fmtUsd(newCap)} keeps ~${fmtUsd(Math.max(extra, 0), 0)} more upside for a small premium give-up. Same strategy, more headroom.`,
          accept: `rolled cap → ${fmtUsd(newCap)} for net credit · position updated`,
        });
      } else {
        pushFeed("suggest", `vol cooled on ${ticket.assetSymbol} - cheaper protection available`);
        setSuggestion({
          id: pos.id,
          title: `Options on ${ticket.assetSymbol} just got ~15% cheaper`,
          detail: `Implied volatility dropped. Restructuring the same position at today's prices improves your terms with no extra risk. Want me to refresh it?`,
          accept: `restructured at cheaper vol · terms improved`,
        });
      }
    });
  }, [ticket, ticketQty, venueMode]);

  const onAccept = useCallback(() => {
    if (!suggestion) return;
    pushFeed("action", suggestion.accept);
    setMessages((m) => [
      ...m,
      { role: "agent", text: "Done - restructured. You can always change your mind the same way: accept a suggestion, or just tell me what you want instead." },
    ]);
    setSuggestion(null);
  }, [suggestion]);

  const onDismiss = useCallback(() => {
    pushFeed("info", "suggestion dismissed - position unchanged");
    setSuggestion(null);
  }, []);


  const [manage, setManage] = useState<null | "hosted" | "browser" | "self">(null);
  const [feedOpen, setFeedOpen] = useState(false);
  const lastFeed = feed.length ? feed[feed.length - 1] : null;

  const manageButtons = (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[11px] font-bold uppercase text-mint">✓ deployed · run it:</span>
      {wallet && venueMode === "v2" && (
        <button onClick={() => setManage("hosted")}
          className="border-2 border-paper bg-accent px-2.5 py-1 font-mono text-[11px] font-bold uppercase text-ink shadow-hardsm transition-transform hover:-translate-x-px hover:-translate-y-px">
          24/7 hosted
        </button>
      )}
      {wallet && venueMode === "v2" && (
        <button onClick={() => setManage("browser")}
          className="border-2 border-amber px-2.5 py-1 font-mono text-[11px] uppercase text-amber transition-colors hover:bg-amber hover:text-ink">
          browser order
        </button>
      )}
      <button onClick={() => setManage("self")}
        className="border-2 border-line px-2.5 py-1 font-mono text-[11px] uppercase text-fog transition-colors hover:border-fog hover:text-paper">
        self-host
      </button>
    </div>
  );

  return (
    <main className="bg-ink px-3 pb-3 pt-16 lg:h-screen lg:overflow-hidden">
      <div className="mx-auto flex h-full max-w-[1500px] flex-col">
        {/* top bar: tabs · assets · venue · wallet */}
        <div className="mb-2 flex flex-wrap items-center gap-2 border-2 border-line bg-pane px-2 py-1.5">
          <div className="flex font-mono text-[11px] uppercase tracking-[0.08em]">
            {([["trade", "Trade desk"], ["console", "Console"]] as const).map(([id, label]) => (
              <button key={id} onClick={() => setView(id)}
                className={`border-2 px-3 py-1 transition-colors ${
                  view === id ? "border-mint bg-ink font-bold text-mint" : "border-transparent text-fog hover:text-paper"
                }`}>
                {label}
              </button>
            ))}
          </div>
          <div className="h-5 w-px bg-line" />
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {ASSETS.map((a) => {
              const on = a.symbol === selected;
              return (
                <button key={a.symbol} onClick={() => onSelectAsset(a.symbol)}
                  className={`shrink-0 border px-2 py-1 font-mono text-[11px] transition-colors ${
                    on ? "border-mint text-mint" : a.live ? "border-transparent text-paper hover:border-line" : "border-transparent text-fog"
                  }`}>
                  <span className="font-bold">{a.symbol}</span>
                  {on && <span className="ml-1.5 text-mint/70">{fmtUsd(a.spot)} · IV {fmtPct(a.iv, 0)}</span>}
                  {!a.live && <span className="ml-1 text-[8px] uppercase text-amber">soon</span>}
                </button>
              );
            })}
          </div>
          <select value={onMainnet ? "mainnet" : "demo"}
            onChange={(e) => {
              setNetwork(e.target.value === "mainnet" ? "mainnet" : "demo");
              window.location.reload();
            }}
            title="Switch network"
            className={`border-2 px-1.5 py-1 font-mono text-[10px] font-bold uppercase focus:outline-none ${
              onMainnet ? "border-rose bg-rose/10 text-rose" : "border-line bg-ink text-mint"
            }`}>
            <option value="demo">Demo · testnet</option>
            <option value="mainnet">Mainnet · live</option>
          </select>
          {hasWallet() && (
            <button onClick={onConnect} disabled={!!connecting}
              className={`border-2 px-2.5 py-1 font-mono text-[10.5px] uppercase transition-colors ${
                wallet ? "border-mint text-mint" : "border-paper bg-accent font-bold text-ink shadow-hardsm"
              } disabled:opacity-70`}>
              {connecting ? "connecting…" : wallet ? `${shortAddr(wallet.address)}` : "Connect wallet"}
            </button>
          )}
          {onMainnet ? (
            <span className="border-2 border-rose bg-rose/10 px-1.5 py-1 font-mono text-[9px] font-bold uppercase text-rose">
              ● real funds
            </span>
          ) : (
            <span className="border border-amber px-1.5 py-1 font-mono text-[9px] uppercase text-amber">demo pricing</span>
          )}
        </div>

        {/* live agent status + controls (mainnet, connected, enrolled) */}
        {onMainnet && wallet && hostedSt?.enrolled && (
          <AgentBar st={hostedSt} deriveWallet={hostedSt.derive_wallet ?? wallet.address}
            ownerEoa={wallet.address} onChanged={refreshHosted} />
        )}
        {/* mainnet, connected, but this wallet isn't set up / whitelisted */}
        {onMainnet && wallet && !connecting && hostedSt === null && (
          <div className="mb-2 border-2 border-amber bg-pane px-3 py-2 font-mono text-[11px] text-amber">
            No agent on this wallet. Deploy a strategy → 24/7 hosted to set one up.
            Mainnet is whitelist-gated — if setup is blocked, your wallet isn't approved yet.
          </div>
        )}

        {/* wallet-sync progress strip */}
        {connecting && (
          <div className="mb-2 flex items-center gap-2 border-2 border-mint bg-pane px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-mint">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-mint" />
            {connecting}
            <span className="flex-1" />
            <span className="text-fog normal-case">read-only · no signatures</span>
          </div>
        )}

        {view === "console" ? (
          <div className="min-h-0 flex-1 overflow-y-auto"><Console ownerEoa={wallet?.address ?? null} /></div>
        ) : (
          <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[230px_minmax(0,1fr)_360px] lg:grid-rows-[minmax(0,1fr)]">
            {/* left rail */}
            <div className="min-h-0 max-lg:max-h-96">
              <StrategyRail
                symbol={selected} activeId={pickedId}
                onPick={(id) => structure(selected, id)}
                holdings={portfolio}
                usdc={deriveAcct ? deriveAcct.usdc : wallet?.usdc ?? 0}
                walletLabel={wallet ? shortAddr(wallet.address) : null}
                onSelectAsset={onSelectAsset} selected={selected}
                vaultLabel={deriveAcct ? `${deriveAcct.sub != null ? `subaccount ${deriveAcct.sub}` : "live"}` : null}
                walletHoldings={deriveAcct && wallet ? wallet.holdings : null}
              />
            </div>

            {/* center: hero ticket + status strip */}
            <div className="flex min-h-0 flex-col gap-2">
              <div ref={ticketRef} className="min-h-0 flex-1">
                {ticket && (
                  <TradeTicket q={ticket} qty={ticketQty} onDeploy={onDeploy}
                    deployed={deployedTicket} venueMode={venueMode}
                    footerExtra={manageButtons} />
                )}
              </div>
              <button onClick={() => setFeedOpen(true)}
                className="flex shrink-0 items-center gap-2 border-2 border-line bg-pane px-3 py-1.5 text-left font-mono text-[11px] transition-colors hover:border-fog">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-mint" />
                <span className="text-fog">agent</span>
                <span className="text-paper">{positions.length} open</span>
                {suggestion && <span className="border border-amber px-1 text-[9.5px] uppercase text-amber">1 suggestion</span>}
                <span className="min-w-0 flex-1 truncate text-fog">
                  {lastFeed ? `${lastFeed.ts} ${lastFeed.text}` : "the loop starts when you deploy"}
                </span>
                <span className="text-fog">▸</span>
              </button>
            </div>

            {/* right: chat */}
            <div className="flex min-h-0 flex-col gap-2 max-lg:h-[480px]">
              <div className="min-h-0 flex-1">
                <IntentChat messages={messages} onSend={onSend} thinking={thinking} defaultsNote={defaultsNote} />
              </div>
              {onMainnet && hostedSt?.enrolled && pendingPlan && (
                <div className="flex items-center gap-2 border-2 border-mint bg-ink px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-mint">
                    ready to deploy · {pendingPlan.label}
                  </span>
                  <button onClick={() => void deployPlan()} disabled={deploying}
                    className="shrink-0 border-2 border-paper bg-accent px-3 py-1 font-mono text-[11px] font-bold uppercase text-ink shadow-hardsm transition-transform hover:-translate-y-px disabled:opacity-60">
                    {deploying ? "…" : "Deploy to agent · dry-run"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* overlays */}
      {gated && <TermsGate onAccept={() => setGated(false)} />}
      {feedOpen && (
        <Modal title="Agent · active management" onClose={() => setFeedOpen(false)}>
          <AgentFeed positions={positions} feed={feed} suggestion={suggestion}
            onAccept={() => { onAccept(); }} onDismiss={onDismiss} />
        </Modal>
      )}
      {manage === "hosted" && wallet && (
        <Modal title="Run it 24/7 · hosted pilot" onClose={() => setManage(null)}>
          <HostedPanel ownerEoa={wallet.address} />
        </Modal>
      )}
      {manage === "browser" && wallet && ticket && (
        <Modal title="Place it from this browser" onClose={() => setManage(null)}>
          <TestnetPanel q={ticket} qty={ticketQty} ownerEoa={wallet.address} />
        </Modal>
      )}
      {manage === "self" && ticket && (
        <Modal title="Self-host the agent" onClose={() => setManage(null)}>
          <RunItYourself q={ticket} qty={ticketQty} mode={venueMode} />
        </Modal>
      )}
    </main>
  );
}
