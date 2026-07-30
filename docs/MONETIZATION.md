# Overwrite — Monetization Decision Memo

*July 30, 2026. Companion to BUSINESS.md (paths) and HOSTED.md (Path B spec).
Evidence base: claude/overwrite-competitive-landscape.md (full competitor report).*

## The one-paragraph answer

Don't launch a token. Don't copy the 2-and-10 vault fee. Build a **flow
business on Derive's builder rails now** (per-trade builder fee + broker
rebates — live revenue with zero regulatory drama), add a **hosted
subscription** when the waitlist proves demand, price the eventual vault as a
**10% success fee on harvested premium only** (the Giza precedent — the only
agent-fee model with real traction in 2026), and chase **treasury mandates**
(the Rysk×Hyperion model) as the big-ticket B2B lane. Token only if, years
from now, there's a network to coordinate — not before revenue.

## What the evidence says about each model

| Model | Evidence | Verdict |
|---|---|---|
| **Token launch** | RBN −80%+, AEVO −80%+, NUTS −97% ($35M raised → $3.6M mcap), HEGIC dead. Even DRV is −59% from ATH *with* 25%-of-revenue buybacks. Options-protocol tokens do not accrue. | ❌ Skip. A token now = securities risk + sell pressure + distraction, zero proven upside. |
| **2/10 vault fees (Ribbon model)** | Ribbon at ~$300M peak TVL earned ~$2.9M/yr against ~$4.4M/yr in token emissions — never profitable; pivoted away; leftover vaults later hacked. Thetanuts: $62K TVL remaining. | ❌ The category's own inventor abandoned it. |
| **Per-trade / flow fees (builder codes)** | Hyperliquid builder codes: $13.1M+ cumulative paid out; Insilico charges 1bp; Axiom did $100M in 129 days on flow fees. Derive Builder Codes: flat USDC per trade, paid to your wallet every 4 weeks, stacks with 10–50% broker rebates. Caveat: flow revenue decays with momentum (pvp.trade −87% from peak). | ✅ Best *first* revenue. Meters with usage, works for OSS users and our own agent, no custody, no counsel needed. |
| **Success fee on realized yield** | Giza ARMA: 10% of realized yield only, $30M+ AUM — the most-traction agent-fee model in DeFi. Charges only when the user actually earned premium; perfectly aligned with "honest yield" positioning. | ✅ The fee model for hosted + vault. |
| **Subscription SaaS** | No options-bot SaaS with public revenue exists (greenfield); TradFi covered-call wrappers sustain 0.35–0.60% ER at $80B+ AUM, proving people pay for packaged covered calls. | ✅ Simple, predictable; hosted tier $29/mo. |
| **Treasury mandates (B2B)** | Rysk×Hyperion (Nasdaq: HYPD): institutional volatility-income vault on a public company's treasury. DATs and crypto treasuries need yield on idle ETH/BTC/HYPE; soon tokenized-equity treasuries. One mandate ≈ hundreds of retail users. | ✅ The whale lane. Overwrite's pitch: automated, risk-railed, honest reporting, Derive depth. |

## The revenue stack (sequenced)

1. **Now (week 1): builder-code flow.** Register Derive API Broker (10%
   rebate tier immediately) + set `derive.extra_fee` (start $0.05/trade,
   config already supports it). Every trade the agent makes — ours, OSS
   users', hosted users' — pays the same wallet. Revenue from day one of
   mainnet.
2. **Weeks 2–6: hosted subscription.** $29/mo (waitlist is live on
   overwrite.pro). At 100 users ≈ $35K/yr + their flow fees.
3. **Post-audit: the vault** at **1% mgmt / 10% of harvested premium** —
   half Ribbon's failed take, charged only on realized premium. At $10M TVL
   on ~20% gross premium ≈ $100K mgmt + $200K perf ≈ **$300K/yr**, before
   flow fees on the vault's own trades.
4. **Parallel: 1–2 treasury mandates.** Custom parameters, reporting, fee
   negotiable (expect 10–20% of premium). This is also the strongest thing
   to pitch **through Derive's institutional pipeline** (their Feb 2026
   Variant round was explicitly about custody integrations + regulated
   capital).

## Rysk, honestly

Closest competitor, real traction ($51.6M TVL on HyperEVM), but: it's a
**venue, not an agent** (users still pick strikes per auction), it charges
**no fee at all** (points-subsidized, pre-revenue, thinly capitalized), it
has no automation layer and no tokenized-equity products. Competing with
free is only a problem if you sell the same thing — Overwrite sells the
*automation and the mandate*, not the venue. Watch their TGE; their fee
switch will validate the category's pricing.

## The Derive question: yes, talk to your friends

Derive's own vaults charge **zero fees** — they monetize exchange flow and
explicitly built Builder Codes so third parties monetize strategy on top.
A strategy agent is structurally aligned with them, not competitive. Ask for:

1. **Equities timeline** — listing names/dates for tokenized-stock options
   (the single most valuable piece of information for Overwrite's roadmap).
2. **Broker-tier boost** — negotiated rebate tier / stDRV arrangement rather
   than grinding volume tiers.
3. **Grant + co-marketing** as the first third-party strategy agent and
   first covered-call vault on their equities launch. They need launch-day
   TVL and a story; Overwrite is both.
4. **TSA deployer whitelisting path** for the vault contracts (Derive Chain
   deploys are DAO-gated).
5. **Institutional intros** — their custody/regulated-capital pipeline is
   exactly where treasury mandates live.

What NOT to do: don't ask them to bless yield claims (keep the honest-yield
framing ours), and don't stay stealth — the moat is track record +
distribution + being first on their equities listing, none of which secrecy
protects. Show them the live testnet agent and overwrite.pro; that demo is
the pitch.

## Kill criteria / revisit triggers

- Flow fees < $500/mo after 3 months of mainnet + 50 OSS installs → the
  free-rider rate is too high; shift weight to hosted.
- Derive ships first-party strategy automation → become their best partner
  strategy, or pivot venue (Rysk/Hypercall adapters — the venue interface
  already abstracts this).
- A token is only on the table if a future network (curated multi-strategy
  marketplace, underwriting layer per the Selby allocation thesis) needs
  coordination — and then as revenue-backed, post-traction, with counsel.
