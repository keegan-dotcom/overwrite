import { useCallback, useEffect, useRef, useState } from "react";
import { asset, strategy, Quote, DEMO_PORTFOLIO, roundStrike, ASSETS, STRATEGIES, IntentParams, Holding } from "../data/appdata";
import { connectWallet, shortAddr, WalletState, listProviders, WalletProvider } from "../lib/wallet";
import { callPrice, strikeForYield, fmtUsd, fmtPct } from "../lib/options";
import { parseIntent } from "../lib/intent";
import { planAndValidate, describePlan } from "../lib/strategy/planner";
import { refreshLivePrices } from "../lib/prices";
import { HostedPanel } from "../components/app/HostedPanel";
import { Console } from "../components/app/Console";
import { TermsGate, termsAccepted } from "../components/app/TermsGate";
import { hostedStatus, HostedStatus, hostedDeployPlan, hostedSetLive, hostedPause, strategyLabel } from "../lib/hosted";
import { TuneCard } from "../components/app/TuneCard";
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
  text: "Tell me what you want in plain English — \"earn 10% on my BTC\", \"protect my ETH\", or \"buy $500 of ETH calls\". I'll structure it, show every tradeoff, and run it 24/7 from your own vault — tune it, then deploy in one click.",
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
  // Derive team wallets (whitelisted) — show a one-time welcome when they connect.
  const [welcomeTeam, setWelcomeTeam] = useState(false);
  // when >1 wallet extension is installed, let the user pick which to connect.
  const [walletPicker, setWalletPicker] = useState<WalletProvider[] | null>(null);
  // connected-address dropdown (copy / switch / disconnect).
  const [walletMenu, setWalletMenu] = useState(false);
  const [copied, setCopied] = useState(false);
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

  // Real-account context used to size/validate plans: prefer the live venue
  // snapshot, else the connected Derive account / wallet. Undefined (→ demo
  // portfolio) only when NOT connected on mainnet — the marketing preview.
  const currentAcct = useCallback(():
    { holdings: { asset: string; amount: number }[]; freeUsdc: number } | undefined => {
    if (!(onMainnet && (hostedSt?.collaterals?.length || activeHoldings))) return undefined;
    const cols = hostedSt?.collaterals;
    return cols?.length
      ? {
          holdings: cols.filter((c) => c.asset !== "USDC" && c.amount > 0).map((c) => ({ asset: c.asset, amount: c.amount })),
          freeUsdc: cols.find((c) => c.asset === "USDC")?.amount ?? 0,
        }
      : {
          holdings: (activeHoldings ?? []).filter((h) => h.qty > 0).map((h) => ({ asset: h.symbol, amount: h.qty })),
          freeUsdc: deriveAcct?.usdc ?? 0,
        };
  }, [onMainnet, hostedSt, activeHoldings, deriveAcct]);

  const structure = useCallback((sym: string, stratId: string, params: Partial<IntentParams> = {}, mode: "shelf" | "chat" | "silent" = "shelf") => {
    const a = asset(sym);
    const s = strategy(stratId);
    // saved defaults fill gaps; anything explicit wins
    const merged = { ...prefsRef.current, ...params };
    const q = s.quote(a, merged);
    const held = qtyIn(portfolioRef.current, sym);
    // Sizing model: COVERED strategies scale to what you hold; DIRECT buys and
    // perps are one position by default, then sized by $-budget / leverage.
    const HOLD_SCALED = new Set(["income", "shield", "collar", "neutral"]);
    const DIRECT_BUY = new Set(["call", "put", "lotto"]);
    let qty = 1;
    if (HOLD_SCALED.has(stratId) && held > 0) qty = held;
    else if (DIRECT_BUY.has(stratId) && merged.sizeUsd && (q.legs[0]?.premium ?? 0) > 0) {
      qty = Math.max(0.1, Math.round((merged.sizeUsd / q.legs[0].premium) * 10) / 10);
    }
    setSelected(sym);
    setPickedId(stratId);
    setTicket(q);
    setTicketQty(qty);
    setDeployedTicket(false);
    // keep the deployable IR plan in sync with the ticket, so one-click
    // "Approve & deploy" works for rail picks too — not just the chat path.
    try {
      const { plan, result } = planAndValidate(
        { symbol: sym, strategyId: stratId, params: merged, understood: [] }, currentAcct());
      // sync the deployable contract count to the ticket's $-budget size
      if (result.ok && DIRECT_BUY.has(stratId)) {
        for (const l of plan.legs) if (l.sizing.kind === "contracts") l.sizing.amount = qty;
      }
      setPendingPlan(result.ok ? plan : null);
    } catch { setPendingPlan(null); }
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
  }, [currentAcct]);

  // the page opens composed: default strategy on the default asset. MOUNT ONLY —
  // `structure` changes identity when the account context updates (every hosted
  // poll), and we must NOT recompose (that would reset the desk to BTC/income and
  // wipe whatever the user is reviewing). eslint-disable is intentional.
  const composedOnce = useRef(false);
  useEffect(() => {
    if (composedOnce.current) return;
    composedOnce.current = true;
    structure("BTC", "income", {}, "silent");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure]);

  const onSelectAsset = useCallback((sym: string) => {
    structure(sym, pickedId ?? "income", {}, "silent");
  }, [structure, pickedId]);

  const onConnect = useCallback(async (chosen?: WalletProvider) => {
    // resolve which wallet to talk to. With EIP-6963 we can see every installed
    // extension, so if there's more than one we ask instead of grabbing whichever
    // won the window.ethereum slot (the cause of "connect does nothing" when a
    // user runs two wallets).
    let provider = chosen?.provider;
    if (!provider) {
      const found = listProviders();
      if (found.length === 0) {
        setMessages((m) => [...m, { role: "agent", text: "I don't see a wallet extension in this browser. Install one (MetaMask, Rabby, …), or if you have several, make sure at least one is enabled, then hit Connect again." }]);
        return;
      }
      if (found.length === 1) provider = found[0].provider;
      else { setWalletPicker(found); return; } // multiple wallets → let them choose
    }
    setWalletPicker(null);
    setConnecting("reading your wallet balances…");
    let w: WalletState | null = null;
    try {
      w = await connectWallet(provider);
    } catch (e) {
      // surface it instead of failing silently — a rejected prompt or a
      // wallet-extension collision both land here.
      const msg = String((e as Error)?.message ?? e);
      const friendly = /reject|denied|4001/i.test(msg)
        ? "Looks like the wallet request was dismissed — hit Connect again and approve it in your wallet."
        : `Couldn't reach your wallet (${msg.slice(0, 120)}). If you have more than one wallet extension installed they can conflict — try disabling the extras, or pick a different wallet.`;
      setConnecting(null);
      setMessages((m) => [...m, { role: "agent", text: friendly }]);
      return;
    }
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
    // Derive team welcome (whitelisted wallets) — purely cosmetic; wrapped so a
    // bad match can never interrupt the connect flow.
    try {
      const team = [
        "0x8ca2c6d79dbc78ceca382136be590ea63eb28b89",
        "0x9251d5835f4a68d1e3603735b43409941c244343",
      ];
      if (w && team.includes(w.address.toLowerCase())) setWelcomeTeam(true);
    } catch { /* never let a cosmetic check break connect */ }
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
    // On mainnet, size against REAL balances — never the demo portfolio (that
    // was the "24 ETH" bug: when the live venue snapshot hadn't loaded, the
    // planner fell back to DEMO_PORTFOLIO and told you it was working your 24
    // demo ETH instead of your actual holdings). Prefer the live venue snapshot;
    // otherwise use the same Derive-account / connected-wallet balances the
    // vault already shows. Only fall back to demo when NOT connected (the
    // marketing preview), never once a real wallet is attached.
    let acct: { holdings: { asset: string; amount: number }[]; freeUsdc: number } | undefined;
    if (onMainnet && (hostedSt?.collaterals?.length || activeHoldings)) {
      const cols = hostedSt?.collaterals;
      acct = cols?.length
        ? {
            holdings: cols
              .filter((c) => c.asset !== "USDC" && c.amount > 0)
              .map((c) => ({ asset: c.asset, amount: c.amount })),
            freeUsdc: cols.find((c) => c.asset === "USDC")?.amount ?? 0,
          }
        : {
            holdings: (activeHoldings ?? [])
              .filter((h) => h.qty > 0)
              .map((h) => ({ asset: h.symbol, amount: h.qty })),
            freeUsdc: deriveAcct?.usdc ?? 0,
          };
    }
    const { plan, result } = planAndValidate({
      symbol: p.symbol, strategyId: p.strategyId, params: p.params, understood: p.understood,
    }, acct);
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
  }, [structure, onMainnet, hostedSt]);

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

      // context-aware control commands on mainnet — the chat knows what's live
      // and can pause / go-live / kill / restart / report, all owner-signed.
      if (onMainnet && hostedSt?.enrolled && wallet) {
        let dw = hostedSt.derive_wallet ?? "";
        if (!dw) { try { dw = localStorage.getItem("overwrite_derive_wallet") ?? ""; } catch { /* noop */ } }
        const owner = wallet.address;
        const live = hostedSt.config?.live === true;
        const killed = (hostedSt as { kill?: boolean }).kill === true;
        const runLabel = (hostedSt.config?.plan as { label?: string } | undefined)?.label ?? strategyLabel(hostedSt.config);
        const cmd = text.toLowerCase();
        const control = async (verb: string, fn: () => Promise<unknown>, msg: string) => {
          setThinking(false);
          try { await fn(); setMessages((m) => [...m, { role: "agent", text: msg }]); await refreshHosted(); }
          catch (e) { setMessages((m) => [...m, { role: "agent", text: `Couldn't ${verb}: ${String((e as Error).message ?? e)}` }]); }
        };
        if (/\b(what'?s? (running|live|going on)|current (strategy|position|trade)|^status\b|what am i (running|trading))\b/.test(cmd)) {
          setThinking(false);
          const orders = (hostedSt.open_orders ?? []).map((o) => `${o.direction.toUpperCase()} ${o.amount} ${o.instrument} @ ${o.price}`).join(", ");
          const pos = (hostedSt.positions ?? []).map((p) => `${p.amount} ${p.instrument}`).join(", ");
          const state = killed ? "killed (paused)" : live ? "LIVE — trading real funds" : "dry-run (logging, not trading)";
          const cfgAny = hostedSt.config as { defend_proximity_pct?: number; plan?: { manage?: { defendProximityPct?: number } } } | undefined;
          const dfd = cfgAny?.defend_proximity_pct ?? cfgAny?.plan?.manage?.defendProximityPct;
          const dfdNote = typeof dfd === "number" && dfd > 0
            ? ` Strike defense is ON — it rolls the strike away when price comes within ${Math.round(dfd * 100)}%.`
            : "";
          setMessages((m) => [...m, { role: "agent", text: `Running now: ${runLabel} · ${state}.${orders ? ` Resting: ${orders}.` : ""}${pos ? ` Positions: ${pos}.` : ""}${!orders && !pos ? " No resting order yet — it quotes on the next 15-minute cycle." : ""}${dfdNote} Say "pause", "go live", "kill", or ask for a different strategy to change it.` }]);
          return;
        }
        // arm / disarm strike defense on the RUNNING agent — no strategy rebuild.
        // Re-pushes the same plan with manage.defendProximityPct set (or cleared),
        // then flips live back on if it was live (deploy always lands dry-run).
        const planObj = hostedSt.config?.plan as ({ manage?: { defendProximityPct?: number } } & Record<string, unknown>) | undefined;
        const disarmRe = /\b(?:turn off|disable|stop|remove|cancel)\s+(?:the\s+)?(?:strike\s+)?defen[cs]e\b|\bstop defending\b/;
        const armRe = /\bdefend (?:my |the )?strike\b|\b(?:turn on|enable|arm)\s+(?:the\s+)?(?:strike\s+)?defen[cs]e\b/;
        if (planObj && typeof planObj === "object" && (disarmRe.test(cmd) || armRe.test(cmd))) {
          const disarm = disarmRe.test(cmd);
          const pctM = cmd.match(/(\d+(?:\.\d+)?)\s*%/);
          const pct = disarm ? 0 : Math.min(0.25, Math.max(0.01, pctM ? parseFloat(pctM[1]) / 100 : 0.05));
          const nextPlan = JSON.parse(JSON.stringify(planObj)) as { manage?: { defendProximityPct?: number } };
          if (disarm) {
            if (nextPlan.manage) { delete nextPlan.manage.defendProximityPct; if (!Object.keys(nextPlan.manage).length) delete nextPlan.manage; }
          } else {
            nextPlan.manage = { ...(nextPlan.manage ?? {}), defendProximityPct: pct };
          }
          await control(disarm ? "disarm defense" : "arm defense", async () => {
            await hostedDeployPlan(dw, owner, nextPlan);
            if (live) await hostedSetLive(dw, owner, true); // keep it trading — deploy alone lands dry-run
          }, disarm
            ? `Strike defense OFF. The agent keeps its take-profit and gamma-zone rolls, but no longer rolls the strike away as price approaches.${live ? "" : " (Agent is paused — say \"go live\" to trade.)"}`
            : `Strike defense ON at ${Math.round(pct * 100)}%. From the next cycle: if price comes within ${Math.round(pct * 100)}% of your short strike, the agent buys it back and re-sells further out — over and over, until you kill it.${live ? "" : " (Agent is paused — say \"go live\" to trade.)"}`);
          return;
        }
        if (/\b(kill( it| the agent| everything)?|shut (it )?down|emergency stop)\b/.test(cmd) && !/un-?kill/.test(cmd)) {
          await control("kill", () => hostedPause(dw, owner, true), "Killed — the agent stops immediately and places no more orders. Your positions are untouched. Say \"restart\" to bring it back.");
          return;
        }
        if (/\b(un-?kill|restart|bring it back|resume the agent)\b/.test(cmd)) {
          await control("restart", () => hostedPause(dw, owner, false), "Restarted — the agent's back to dry-run. Say \"go live\" when you want it trading.");
          return;
        }
        if (/\b(pause|stop trading|halt|go to dry|dry.?run)\b/.test(cmd) && !/kill/.test(cmd)) {
          await control("pause", () => hostedSetLive(dw, owner, false), "Paused — back to dry-run. It logs what it would do but places nothing. Say \"go live\" to resume.");
          return;
        }
        if (/\b(go live|turn (it )?on|start trading|make it live|resume trading)\b/.test(cmd)) {
          if (!window.confirm("Go LIVE with real funds on Derive mainnet? The agent will place real orders on its next cycle.")) { setThinking(false); return; }
          await control("go live", () => hostedSetLive(dw, owner, true), "Live — the agent will place real orders on its next 15-minute cycle. Say \"pause\" anytime.");
          return;
        }
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
  }, [structure, applyIntent, onMainnet, hostedSt, wallet, refreshHosted]);

  // ONE-CLICK deploy: push the plan to your 24/7 hosted agent AND go live, in a
  // single action. Like an etherfi deposit — approve once, it starts working.
  // The only extra step that can ever exist is the ONE-TIME session-key setup;
  // once that's done, every future deploy is a single click (+ one real-funds
  // confirm). No dry-run detour, no "browser vs hosted" fork.
  const deployLive = useCallback(async () => {
    if (!pendingPlan || !wallet) return;
    let dw = hostedSt?.derive_wallet ?? "";
    if (!dw) { try { dw = localStorage.getItem("overwrite_derive_wallet") ?? ""; } catch { /* noop */ } }
    // not set up yet → open the one-time agent setup (enroll + register key).
    if (!/^0x[0-9a-fA-F]{40}$/.test(dw) || !hostedSt?.enrolled || hostedSt.status !== "active") {
      setManage("hosted");
      setMessages((m) => [...m, { role: "agent", text: "One-time setup first: authorize your 24/7 agent's key (takes ~2 min). After that, deploying any strategy is a single click." }]);
      return;
    }
    const existing = (hostedSt?.config?.plan as { label?: string } | undefined)?.label
      ?? (hostedSt?.status === "active" ? strategyLabel(hostedSt?.config) : "");
    const msg = existing
      ? `Replace your live strategy (${existing}) with "${pendingPlan.label}" and go LIVE now with real funds? Your existing orders get cancelled and it places its first order immediately.`
      : `Deploy "${pendingPlan.label}" and go LIVE now with real funds on Derive mainnet? It places its first order immediately. You can pause or unwind anytime.`;
    // degen (leverage / naked) → an explicit extra warning before real funds move.
    const degen = pendingPlan.constraints?.requireDefinedRisk === false
      || pendingPlan.legs.some((l) => l.venue === "perp");
    const warn = degen ? "⚠ HIGH-RISK STRATEGY (leverage / naked options): this can be liquidated or lose MORE than you put in.\n\n" : "";
    if (!window.confirm(warn + msg)) return;
    setDeploying(true);
    try {
      await hostedDeployPlan(dw, wallet.address, pendingPlan); // sets the plan (server forces dry-run)
      await hostedSetLive(dw, wallet.address, true);           // …then flips it live + fires one cycle now
      setDeployedTicket(true);
      setMessages((m) => [...m, {
        role: "agent",
        text: `Live — "${pendingPlan.label}" is deployed and your agent is placing its first order now. Watch it fill in the Console; pause, unwind, or restructure any time.`,
      }]);
      setPendingPlan(null);
      await refreshHosted();
    } catch (e) {
      setMessages((m) => [...m, { role: "agent", text: `Couldn't deploy: ${String((e as Error).message ?? e)}` }]);
    } finally { setDeploying(false); }
  }, [pendingPlan, wallet, hostedSt, refreshHosted]);

  const onDeploy = useCallback(() => {
    if (!ticket) return;
    // Real app (mainnet) with a connected wallet: Approve & deploy IS the
    // one-click hosted go-live — no second screen, no "run it: hosted/browser".
    if (onMainnet && wallet) { void deployLive(); return; }
    // Pre-connect marketing preview: simulate the loop so visitors can see it.
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
        text: `This is a preview of the loop — take-profits, rolls, and market reactions are all automatic. Connect your wallet to deploy it live to your own 24/7 agent in one click.`,
      },
    ]);

    const leg = ticket.legs[0];
    if (leg) {
      pushFeed("action", `deploy: ${leg.side === "short" ? "SELL" : "BUY"} ${ticket.assetSymbol} ${fmtUsd(leg.strike)} ${leg.kind.toUpperCase()} ×${(leg.qty * qty).toLocaleString()} → post-only at mark`);
    } else {
      // perp / linear leg — no option legs to describe
      pushFeed("action", `deploy: ${ticket.assetQty >= 0 ? "LONG" : "SHORT"} ${Math.abs(ticket.assetQty)}× ${ticket.assetSymbol} perp → market`);
    }
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
  }, [ticket, ticketQty, venueMode, onMainnet, wallet, deployLive]);

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


  const [manage, setManage] = useState<null | "hosted">(null);
  const [feedOpen, setFeedOpen] = useState(false);
  const lastFeed = feed.length ? feed[feed.length - 1] : null;

  // When a real 24/7 agent is live, the active-management popup (and its footer
  // bar) must show the ACTUAL account — not the empty demo desk. Mirror the
  // Console's live status so "open positions" never reads 0 while a real
  // position is on.
  const agentLive = onMainnet && hostedSt?.enrolled && hostedSt.status === "active";
  const liveFeed = agentLive
    ? {
        positions: (hostedSt!.positions ?? []).map((p) => ({
          instrument: p.instrument, amount: p.amount, mark: p.mark, upnl: p.unrealized_pnl,
        })),
        cycles: (hostedSt!.cycles ?? []).slice(0, 24).map((c) => ({
          ts: new Date(c.ts).toLocaleTimeString(), msg: c.msg, ok: c.ok,
        })),
      }
    : null;
  const openCount = liveFeed ? liveFeed.positions.length : positions.length;

  // Hosted-only: after a deploy, the single next step is the Console (watch it
  // run / pause / unwind). No "browser vs hosted vs self-host" fork — the site
  // is for people who want the hosted agent, full stop.
  const manageButtons = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-[13px] font-bold uppercase text-mint">✓ live</span>
      <button onClick={() => setView("console")}
        className="border-2 border-paper bg-accent px-3 py-1 font-mono text-[13px] font-bold uppercase text-ink shadow-hardsm transition-transform hover:-translate-x-px hover:-translate-y-px">
        Open Console →
      </button>
    </div>
  );

  const disconnectWallet = useCallback(() => {
    setWallet(null); setDeriveAcct(null); setHostedSt(null); setWalletMenu(false);
    try { localStorage.removeItem("overwrite_read_auth"); } catch { /* ignore */ }
  }, []);
  const switchWallet = useCallback(() => {
    setWalletMenu(false); setWallet(null); setDeriveAcct(null); setHostedSt(null);
    const found = listProviders();
    if (found.length <= 1) void onConnect(found[0]);
    else setWalletPicker(found);
  }, [onConnect]);

  return (
    <main className="bg-ink px-3 pb-3 pt-16 lg:h-screen lg:overflow-hidden">
      {welcomeTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4"
             onClick={() => setWelcomeTeam(false)}>
          <div className="max-w-md border-2 border-mint bg-pane p-6 text-center shadow-hardsm"
               onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 font-mono text-[13px] uppercase tracking-[0.12em] text-mint">Overwrite × Derive</div>
            <h2 className="mb-2 text-2xl font-bold text-paper">Welcome, Derive team</h2>
            <p className="mb-4 text-sm text-fog">
              Your wallet is whitelisted on the V2 mainnet pilot. Describe a goal in plain
              English and the agent structures a coherence-checked options trade on your
              books — deploy to dry-run, then flip it live with an owner-signed message.
            </p>
            <button onClick={() => setWelcomeTeam(false)}
              className="border-2 border-paper bg-accent px-4 py-1.5 font-mono text-[13px] font-bold uppercase text-ink shadow-hardsm transition-transform hover:-translate-x-px hover:-translate-y-px">
              Let’s go
            </button>
          </div>
        </div>
      )}
      {walletPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4"
             onClick={() => setWalletPicker(null)}>
          <div className="w-full max-w-sm border-2 border-mint bg-pane p-5 shadow-hardsm"
               onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 font-mono text-[13px] uppercase tracking-[0.12em] text-mint">Choose a wallet</div>
            <p className="mb-3 text-xs text-fog">More than one wallet extension is installed. Pick the one holding the account you want to connect.</p>
            <div className="flex flex-col gap-1.5">
              {walletPicker.map((p) => (
                <button key={p.uuid} onClick={() => { void onConnect(p); }}
                  className="flex items-center gap-2.5 border-2 border-line bg-ink px-3 py-2 text-left font-mono text-[14px] uppercase text-paper transition-colors hover:border-mint hover:text-mint">
                  {p.icon && <img src={p.icon} alt="" className="h-5 w-5" />}
                  {p.name}
                </button>
              ))}
            </div>
            <button onClick={() => setWalletPicker(null)}
              className="mt-3 font-mono text-[13px] uppercase text-fog hover:text-paper">
              cancel
            </button>
          </div>
        </div>
      )}
      <div className="mx-auto flex h-full max-w-[1500px] flex-col">
        {/* top bar: tabs · assets · venue · wallet */}
        <div className="mb-2.5 flex flex-wrap items-center gap-2.5 border-2 border-line bg-pane px-2.5 py-2">
          <div className="flex gap-1 font-mono text-[14px] uppercase tracking-[0.06em]">
            {([["trade", "Trade desk"], ["console", "Console"]] as const).map(([id, label]) => (
              <button key={id} onClick={() => setView(id)}
                className={`border-2 px-3.5 py-1.5 transition-colors ${
                  view === id ? "border-mint bg-ink font-bold text-mint" : "border-transparent text-fog hover:text-paper"
                }`}>
                {label}
              </button>
            ))}
          </div>
          <div className="h-6 w-px bg-line" />
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {ASSETS.map((a, i) => {
              const on = a.symbol === selected;
              const groupOf = (s: string) =>
                ["BTC", "ETH", "HYPE"].includes(s) ? 0 : s === "XAUT" ? 1 : 2;
              const newGroup = i > 0 && groupOf(a.symbol) !== groupOf(ASSETS[i - 1].symbol);
              return (
                <div key={a.symbol} className="flex shrink-0 items-center gap-1.5">
                  {newGroup && <span className="h-5 w-px bg-line/70" />}
                  <button onClick={() => onSelectAsset(a.symbol)}
                    className={`shrink-0 border px-2.5 py-1.5 font-mono text-[14.5px] transition-colors ${
                      on ? "border-mint text-mint" : a.live ? "border-transparent text-paper hover:border-line" : "border-transparent text-fog"
                    }`}>
                    <span className="font-bold">{a.symbol}</span>
                    {on && <span className="ml-1.5 text-[13px] text-mint/70">{fmtUsd(a.spot)} · IV {fmtPct(a.iv, 0)}</span>}
                    {!a.live && <span className="ml-1 text-[11.5px] uppercase tracking-wide text-amber">soon</span>}
                  </button>
                </div>
              );
            })}
          </div>
          <select value={onMainnet ? "mainnet" : "demo"}
            onChange={(e) => {
              setNetwork(e.target.value === "mainnet" ? "mainnet" : "demo");
              window.location.reload();
            }}
            title="Switch network"
            className={`border-2 px-2 py-1.5 font-mono text-[13px] font-bold uppercase focus:outline-none ${
              onMainnet ? "border-rose bg-rose/10 text-rose" : "border-line bg-ink text-mint"
            }`}>
            <option value="demo">Demo · testnet</option>
            <option value="mainnet">Mainnet · live</option>
          </select>
          <div className="relative">
            <button
              onClick={() => { if (wallet) setWalletMenu((v) => !v); else void onConnect(); }}
              disabled={!!connecting}
              className={`flex items-center gap-1.5 border-2 px-3 py-1.5 font-mono text-[13.5px] uppercase transition-colors ${
                wallet ? "border-mint text-mint" : "border-paper bg-accent font-bold text-ink shadow-hardsm"
              } disabled:opacity-70`}>
              {connecting ? "connecting…" : wallet ? shortAddr(wallet.address) : "Connect wallet"}
              {wallet && !connecting && <span className="text-[11.5px] leading-none">▾</span>}
            </button>
            {wallet && walletMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setWalletMenu(false)} />
                <div className="absolute right-0 z-50 mt-1 w-56 border-2 border-mint bg-pane shadow-hardsm">
                  <div className="border-b border-line px-3 py-2">
                    <div className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-fog">connected</div>
                    <div className="mt-0.5 break-all font-mono text-[12.5px] text-paper">{wallet.address}</div>
                  </div>
                  <button
                    onClick={() => { try { void navigator.clipboard?.writeText(wallet.address); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* ignore */ } }}
                    className="block w-full px-3 py-2 text-left font-mono text-[13px] uppercase text-paper transition-colors hover:bg-ink hover:text-mint">
                    {copied ? "copied ✓" : "copy address"}
                  </button>
                  <button onClick={switchWallet}
                    className="block w-full px-3 py-2 text-left font-mono text-[13px] uppercase text-paper transition-colors hover:bg-ink hover:text-mint">
                    switch wallet
                  </button>
                  <button onClick={disconnectWallet}
                    className="block w-full border-t border-line px-3 py-2 text-left font-mono text-[13px] uppercase text-rose transition-colors hover:bg-rose hover:text-ink">
                    disconnect
                  </button>
                </div>
              </>
            )}
          </div>
          {onMainnet ? (
            <span className="border-2 border-rose bg-rose/10 px-1.5 py-1 font-mono text-[11.5px] font-bold uppercase text-rose">
              ● real funds
            </span>
          ) : (
            <span className="border border-amber px-1.5 py-1 font-mono text-[11.5px] uppercase text-amber">demo pricing</span>
          )}
        </div>

        {/* live agent status + controls (mainnet, connected, enrolled) */}
        {onMainnet && wallet && hostedSt?.enrolled && (
          <AgentBar st={hostedSt} deriveWallet={hostedSt.derive_wallet ?? wallet.address}
            ownerEoa={wallet.address} onChanged={refreshHosted} />
        )}
        {/* mainnet, connected, but this wallet isn't set up / whitelisted */}
        {onMainnet && wallet && !connecting && hostedSt === null && (
          <div className="mb-2 border-2 border-amber bg-pane px-3 py-2 font-mono text-[13px] text-amber">
            No agent on this wallet. Deploy a strategy → 24/7 hosted to set one up.
            Mainnet is whitelist-gated — if setup is blocked, your wallet isn't approved yet.
          </div>
        )}

        {/* wallet-sync progress strip */}
        {connecting && (
          <div className="mb-2 flex items-center gap-2 border-2 border-mint bg-pane px-3 py-1.5 font-mono text-[13px] uppercase tracking-[0.08em] text-mint">
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
                className="flex shrink-0 items-center gap-2 border-2 border-line bg-pane px-3 py-1.5 text-left font-mono text-[13px] transition-colors hover:border-fog">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-mint" />
                <span className="text-fog">agent</span>
                <span className="text-paper">{openCount} open</span>
                {suggestion && !liveFeed && <span className="border border-amber px-1 text-[12px] uppercase text-amber">1 suggestion</span>}
                <span className="min-w-0 flex-1 truncate text-fog">
                  {liveFeed
                    ? (liveFeed.cycles[0] ? `${liveFeed.cycles[0].ts} ${liveFeed.cycles[0].msg}` : "agent live · watching")
                    : lastFeed ? `${lastFeed.ts} ${lastFeed.text}` : "the loop starts when you deploy"}
                </span>
                <span className="text-fog">▸</span>
              </button>
            </div>

            {/* right: chat */}
            <div className="flex min-h-0 flex-col gap-2 max-lg:h-[480px]">
              <div className="min-h-0 flex-1">
                <IntentChat messages={messages} onSend={onSend} thinking={thinking} defaultsNote={defaultsNote} />
              </div>
              {pendingPlan && (
                <TuneCard plan={pendingPlan} onChange={setPendingPlan} />
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
            onAccept={() => { onAccept(); }} onDismiss={onDismiss} live={liveFeed} />
        </Modal>
      )}
      {manage === "hosted" && wallet && (
        <Modal title="Set up your 24/7 agent · one time" onClose={() => setManage(null)}>
          <HostedPanel ownerEoa={wallet.address} />
        </Modal>
      )}
    </main>
  );
}
