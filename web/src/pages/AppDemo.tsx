import { useCallback, useEffect, useRef, useState } from "react";
import { asset, strategy, Quote, DEMO_PORTFOLIO, roundStrike } from "../data/appdata";
import { callPrice, strikeForYield, fmtUsd, fmtPct } from "../lib/options";
import { parseIntent } from "../lib/intent";
import { VaultPanel } from "../components/app/VaultPanel";
import { StrategyShelf } from "../components/app/StrategyShelf";
import { TradeTicket } from "../components/app/TradeTicket";
import { IntentChat } from "../components/app/IntentChat";
import { AgentFeed } from "../components/app/AgentFeed";
import type { ChatMsg, FeedEvent, Position, Suggestion } from "../components/app/types";

const now = () =>
  new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

const holdingQty = (sym: string) => DEMO_PORTFOLIO.find((h) => h.symbol === sym)?.qty ?? 1;

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
  const timers = useRef<number[]>([]);
  const ticketRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(1);
  const lastIntent = useRef<{ symbol: string; strategyId: string; params: Record<string, unknown> } | null>(null);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const pushFeed = (kind: FeedEvent["kind"], text: string) =>
    setFeed((f) => [...f, { ts: now(), kind, text }].slice(-40));

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const structure = useCallback((sym: string, stratId: string, params = {}, fromChat = false) => {
    const a = asset(sym);
    const s = strategy(stratId);
    const q = s.quote(a, params);
    const qty = holdingQty(sym);
    setSelected(sym);
    setPickedId(stratId);
    setTicket(q);
    setTicketQty(qty);
    setDeployedTicket(false);
    if (!fromChat) {
      setMessages((m) => [
        ...m,
        {
          role: "agent",
          text: `Structured ${s.name} on your ${qty.toLocaleString()} ${sym}. ${q.headline} The full ticket - payoff, tradeoffs, what I'll manage - is on the left. Tweak it here: "make the cap $${Math.round((q.capPrice ?? a.spot * 1.2)).toLocaleString()}" or "add a 15% stop".`,
        },
      ]);
    }
    // scroll ticket into view on small screens
    later(60, () => ticketRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    return q;
  }, []);

  const onSend = useCallback((text: string) => {
    setMessages((m) => [...m, { role: "user", text }]);
    setThinking(true);
    later(700, () => {
      // follow-up: "hit my yield target" → drop the cap, solve for yield
      if (/hit my yield|yield target|restructure/i.test(text) && lastIntent.current?.params["targetYieldAnnual"] != null) {
        const li = lastIntent.current;
        const params = { ...li.params, capTarget: null };
        lastIntent.current = { ...li, params };
        const q2 = structure(li.symbol, li.strategyId, params, true);
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
      lastIntent.current = { symbol: p.symbol, strategyId: p.strategyId, params: p.params as Record<string, unknown> };
      const s = strategy(p.strategyId);
      const q = structure(p.symbol, p.strategyId, p.params, true);
      const a = asset(p.symbol);
      setThinking(false);

      // honesty check: does the requested cap actually pay the requested yield?
      let conflict = "";
      const wantY = p.params.targetYieldAnnual;
      if (p.strategyId === "income" && wantY != null && p.params.capTarget != null &&
          q.incomeAnnualPct < wantY * 0.8) {
        const kAlt = strikeForYield(a.spot, wantY, a.iv, q.dte / 365);
        conflict = kAlt
          ? ` One thing you should know: a cap at ${fmtUsd(p.params.capTarget)} only pays ~${fmtPct(q.incomeAnnualPct, 1)}/yr. To actually earn ${fmtPct(wantY, 0)}, the cap has to come down to about ${fmtUsd(roundStrike(kAlt, a))}. Your call - say "hit my yield target" and I'll restructure.`
          : ` One thing you should know: ${fmtPct(wantY, 0)}/yr isn't reachable on ${p.symbol} at today's volatility, even selling at-the-money. The ticket shows what your cap really pays.`;
      }

      setMessages((m) => [
        ...m,
        {
          role: "agent",
          text: `Here's what I built - ${s.name} (${s.proName}) on your ${holdingQty(p.symbol).toLocaleString()} ${p.symbol}. ${q.headline} Every tradeoff is spelled out on the ticket.${conflict} ${a.live ? "Approve it there and I take over the management loop." : "This asset lists on Derive soon - the ticket is a preview you can pre-approve."}`,
          bullets: p.understood,
        },
      ]);
    });
  }, [structure]);

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
        text: `Deployed from your vault. I'm running it now - take-profits, rolls, and market reactions are automatic, and I'll ping you before anything changes shape. Watch the management feed, or just close this tab; that's the point.`,
      },
    ]);

    const leg = ticket.legs[0];
    pushFeed("action", `deploy: ${leg.side === "short" ? "SELL" : "BUY"} ${ticket.assetSymbol} ${fmtUsd(leg.strike)} ${leg.kind.toUpperCase()} ×${(leg.qty * qty).toLocaleString()} → post-only at mark`);
    later(2200, () => pushFeed("info", `filled · ${ticket.incomeMonthly >= 0 ? "premium banked" : "cost paid"}: ${fmtUsd(Math.abs(ticket.incomeMonthly * qty), 0)}`));
    later(4600, () => pushFeed("info", `monitoring · IV ${fmtPct(a.iv, 0)} · margin use 8% · all rails green`));

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
  }, [ticket, ticketQty]);

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

  return (
    <main className="min-h-screen bg-ink px-4 pb-16 pt-24 sm:px-6">
      <div className="mx-auto max-w-[1400px]">
        {/* header */}
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b-2 border-line pb-4">
          <div>
            <h1 className="font-display text-3xl uppercase tracking-wide text-paper sm:text-4xl">
              Overwrite <span className="text-mint">App</span>
            </h1>
            <p className="mt-1 max-w-2xl font-serif text-[14px] leading-snug text-fog">
              Intent-based options for people who don't speak greeks. Pick a
              strategy off the shelf or just say what you want - the agent
              structures it, disclosures first, and manages it from your own
              isolated vault.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 font-mono text-[10.5px] uppercase tracking-[0.12em]">
            <span className="border-2 border-amber px-2 py-0.5 text-amber">demo · simulated pricing</span>
            <span className="text-fog">venue: Derive · BTC ETH HYPE live · equities on listing</span>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-12">
          {/* left: vault + feed */}
          <div className="space-y-4 lg:col-span-3">
            <VaultPanel selected={selected} onSelect={(s) => { setSelected(s); setPickedId(null); }} positions={positions} />
            <div className="hidden lg:block">
              <AgentFeed positions={positions} feed={feed} suggestion={suggestion} onAccept={onAccept} onDismiss={onDismiss} />
            </div>
          </div>

          {/* center: shelf + ticket */}
          <div className="space-y-4 lg:col-span-5">
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-fog">
                  Off the shelf · {selected}
                </div>
                <div className="font-mono text-[11px] text-fog">
                  spot {fmtUsd(asset(selected).spot)} · IV {fmtPct(asset(selected).iv, 0)}
                </div>
              </div>
              <StrategyShelf symbol={selected} activeId={pickedId} onPick={(id) => structure(selected, id)} />
            </div>
            <div ref={ticketRef}>
              {ticket ? (
                <TradeTicket q={ticket} qty={ticketQty} onDeploy={onDeploy} deployed={deployedTicket} />
              ) : (
                <div className="border-2 border-dashed border-line px-6 py-10 text-center font-serif text-[14px] italic text-fog">
                  Pick a strategy above - or tell the agent what you want →
                  <br />The structured trade appears here with every number and every tradeoff.
                </div>
              )}
            </div>
          </div>

          {/* right: chat */}
          <div className="lg:col-span-4">
            <div className="lg:sticky lg:top-20">
              <IntentChat messages={messages} onSend={onSend} thinking={thinking} />
            </div>
          </div>

          {/* feed on mobile */}
          <div className="lg:hidden">
            <AgentFeed positions={positions} feed={feed} suggestion={suggestion} onAccept={onAccept} onDismiss={onDismiss} />
          </div>
        </div>
      </div>
    </main>
  );
}
