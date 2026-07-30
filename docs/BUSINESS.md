# Overwrite — Business Memo

**Covered-call vaults on tokenized stocks, built on Derive.**
Internal memo for Selby Studio. Written July 30, 2026. Honest, not promotional. All figures researched July 29–30, 2026.

---

## 1. Thesis and why now

**One line:** Be the covered-call layer for tokenized stocks on Derive — the first vault that turns "I hold AAPLx" into "my AAPLx pays me monthly income" — monetized from day one via Builder Codes, before anyone else ships it.

Three trends are colliding right now, and the intersection is empty:

1. **Tokenized stocks went vertical.** $2.4B market cap, up 2,164% YoY. $5.77B of Solana volume in Q2 alone. Kraken is acquiring Backed; Nasdaq got approval in March for tokenized Russell-1000 trading on DTCC rails with a fuller launch in October. This is no longer a science project — it's an asset class with holders who currently earn nothing on their positions.
2. **On-chain options finally have real execution.** Derive is ~$115M TVL, $1.2B in 30-day options notional, ~90% of on-chain options share, and just listed the first RWA option (XAUT, July 24). The founder has publicly outlined v3 expansion into equities, metals, energy, compute. CLOB/RFQ execution killed the auction-front-running problem that murdered the last DOV generation.
3. **Income demand is proven and enormous.** The TradFi covered-call ETF complex is >$80B AUM. JEPI alone is $40B+ at an 8% distribution. QYLD holds $8B at 12% despite objectively bad total returns. YieldMax sells 111% "yield" on single names. Buyers of income optics are price-insensitive to total-return drag — that's the demand curve we're plugging into.

**Nobody has shipped a covered-call vault on tokenized stocks.** PowerTrade has cash-settled options on 13 xStocks names but no vault. Hypercall launched SPX/NVDA/MU options in June–July but no structured product. Confirmed whitespace, and the window is measured in months, not years.

---

## 2. TAM, sized honestly

Skip the $80B airball. Bottom-up:

**Layer 1 — Derive today.** ~$115M TVL, and Derive's own LRT covered-call vaults (weETHC etc.) already prove depositors will park nine figures of collateral into option-selling strategies when the yield loop works. Realistic capture of options-collateral flow on one venue: single-digit millions to low tens of millions.

**Layer 2 — tokenized stock holders.** $2.4B market cap today, growing >20x YoY. SPYx+QQQx drive >80% of DEX volume, so the float is concentrated in exactly the names covered calls work on. If tokenized stocks reach $10–20B by end-2027 (Nasdaq launch + Kraken/Backed distribution make this the boring case, not the bull case), and covered-call strategies capture the same ~2–4% share of underlying that CC-ETFs hold against US equity ETF assets, that's a **$200M–$800M strategy pool** — on-chain, where there are currently zero products competing for it.

**Layer 3 — the CC-ETF analogy ceiling.** $80B+ TradFi AUM says the demand shape is real, but almost none of it migrates on-chain soon, and US persons are geo-blocked from every major issuer today. Treat this layer as directional evidence, not addressable market.

| Tier | Definition | Size |
|---|---|---|
| TAM | On-chain income strategies on tokenized equities + crypto, 2027 | ~$0.5–1B |
| SAM | Covered-call vaults reachable via Derive v3 + offshore users | ~$100–300M |
| SOM | Overwrite at 18 months, first-mover on Derive, curated deposits | **$10–50M TVL** |

$10–50M SOM sounds small. It isn't: the entire surviving DOV sector is ~$71M today, and Rysk built a real business at $44M. First place in a small-but-compounding category beats tenth place in a big one.

---

## 3. Why every DOV died, and why this shape is different

The DOV sector went >$1B TVL in 2022 to ~$71M now. Ribbon became Aevo and is dead (plus a $2.7M exploit on legacy vaults). Thetanuts is at $62k TVL. StakeDAO exited. The autopsy is specific:

1. **Fixed-schedule auctions were a standing invitation to get arbed.** Everyone knew when Ribbon sold vol. Market makers front-ran the auction and systematically underpaid sellers. Depositors ate mispriced premium every single week.
2. **No strike or delta choice.** One-size-fits-all 0.1-delta weeklies, sold regardless of vol regime. Depositors got the worst of both worlds: capped upside in melt-ups, full downside in crashes.
3. **Crypto-only demand.** "Earn yield on your ETH" competed with staking, points, and everything else in the degen yield stack. The buyer never showed up in size.

What's structurally different now:

- **Execution:** Derive is CLOB/RFQ. There is no scheduled auction to front-run. We work orders like a trader, not like a piñata.
- **Underlying:** "Earn 10% on your Apple stock" is a mainstream pitch with an $80B proof-of-demand behind it. "Earn on your ETH" never had that.
- **Parameters:** Our strategy is delta-targeted (0.25–0.30), vol-aware, and validated against 40 years of CBOE BXM/BXMD data plus live July 2026 IVs — not a hardcoded weekly ritual.
- **Monetization:** Builder Codes mean revenue attaches to flow from day one. Ribbon needed $1B TVL before fees mattered. We don't.

The proof the model survives when done right: Rysk on Hyperliquid — $44M TVL, $15M+ premiums paid, curated epoch vaults — and Derive's own LRT covered-call vaults powering weETH loops. The category isn't dead; the 2022 implementation was.

---

## 4. Competitive map and the window

| Player | Has today | Could ship | Threat level |
|---|---|---|---|
| PowerTrade/PowerDEX | Cash-settled options on 13 xStocks names, offshore | A vault product on top | **Highest near-term.** They have the underlyings live; a vault is one product cycle away. |
| Rysk | $44M TVL, working curated-vault model on Hyperliquid | Add xStocks/HIP-3 equities | High. They've solved the vault, not the equities. |
| Hypercall | SPX/NVDA/MU options on Hyperliquid | Structured products | Medium. New, unproven, but on a venue with flow. |
| Derive first-party | LRT CC vaults, the whole exchange | Equity CC vaults themselves | **Inevitable eventually.** They've done it for LRTs; they'll do it for equities unless someone credible is already there. |

The read: **the prize is being THE covered-call layer on Derive v3 the day equities list** (rumored ~Sept 2026, unconfirmed). Derive benefits from a builder shipping this — it drives options flow on their new listings — which is exactly why they'll tolerate, then court, then eventually compete with us. The defensible position isn't the strategy (replicable) — it's the live track record, the depositor relationships, and later the curator network. All three compound with time-in-market, which is why speed is the whole game.

Meanwhile, **Builder Codes de-risk the wait.** Derive pays arbitrary per-trade extra_fee in USDC to the builder wallet, permissionlessly, settled every 4 weeks, plus API broker rebates of 10–50% of exchange fees by volume tier. Our own agent's flow on ETH/BTC generates revenue before a single external depositor exists.

---

## 5. GTM: three phases

**Phase 1 — now through Derive v3 (0–2 months).** Run the agent on Derive testnet; run my own capital on ETH/BTC mainnet at 0.25–0.30 delta (~30% and ~23% gross annualized premium respectively). Publish a live, verifiable track-record dashboard — every trade, every fill, marked against buy-hold. This is the whole marketing budget. XAUT is live now; add it as the first RWA proof point. Zero regulatory surface: own funds, own risk.

**Phase 2 — Derive v3 equities listing day.** Ship the first covered-call vault on tokenized stocks within days of listing. Curated deposits (Rysk model: capped epochs, allowlist), offshore entity, non-US users only. Lead with the high-IV names where the pitch writes itself — NVDA/TSLA at ~27% gross premium — not SPY at 10.7%, where the product is marginal and the comparison to JEPI unflattering. Parallel track: the non-custodial per-user subaccount shape (user delegates a scoped session key, funds never pooled) as the regulatorily-lighter "agent SaaS" product for users who won't touch a pooled vault.

**Phase 3 — scale: the Morpho of covered calls.** Once one vault has a record, open the platform: multiple curators run vaults with their own delta/tenor/name parameters, and — per the underwritten-allocation thesis — **curators bond first-loss capital behind their own parameters.** Skin-in-the-game curation is what Morpho's $8.13B risk-curator category proved people pay for (curators take 5–15% perf fees; Steakhouse alone runs $2.46B). We take the platform cut; curators take curation fees; depositors get a menu instead of a monolith.

---

## 6. Unit economics

Worked example: **$10M TVL vault, ~20% blended gross premium** (mix of NVDA/TSLA/AAPL-tier names), fees at 1% mgmt + 15% perf — deliberately below our contract caps (2%/30%) and inside Morpho curator norms.

- Gross premium: $2.0M/yr
- Management fee: $100k
- Performance fee (15% of $2.0M): $300k
- Builder Code take on own flow (~5bps on ~$40M annual options notional turnover): ~$20k
- Broker rebates: $10–30k depending on tier
- **Total: ~$430–450k/yr on $10M TVL (~4.3% of TVL)**

The ladder:

| TVL | Approx. annual revenue | What it is |
|---|---|---|
| $1M | ~$45k | Side project that pays for itself; the track record is the real asset |
| $10M | ~$430k | A real solo business. This is the base-case target |
| $100M | ~$3–4M (fee compression at scale) | Requires Phase 3 multi-curator; not a solo outcome |

Two honest caveats. Perf fees on gross premium overstate depositor value — net edge vs buy-hold is +0.8 to +5.8pts in base drift, with bull-year lag of 0.5–5.5pts and single names up to −17pts in melt-ups. Fees must be framed (and possibly high-watermarked) against something defensible or churn kills us in year one's first melt-up. And $10M TVL is earned, not assumed — Rysk needed a year and Hyperliquid's flow to reach $44M.

---

## 7. Risk register

| Risk | Odds | Mitigation |
|---|---|---|
| **Derive never ships equities** (rumor is unconfirmed) | Real | Strategy runs today on ETH (~30%), BTC (~23%), XAUT. Phase 1 revenue and track record don't depend on equities. Fallback: PowerTrade already has xStocks options — port the vault there. |
| **DOV-repeat** — we underprice vol or bleed in melt-ups and TVL exits | The central strategy risk | Delta-targeted CLOB execution (no auction to arb), vol-regime filters, publish net-of-fees vs buy-hold honestly. If our own live results diverge from the Monte Carlo, that's a kill signal, not a marketing problem. |
| **Smart-contract risk** | Always | Ribbon's legacy vaults got exploited for $2.7M *after* the team moved on. Minimal contract surface, audit before external deposits, caps on epoch size. The subaccount/session-key shape holds no pooled funds at all. |
| **Regulatory — US founder** | Serious, manageable | Peirce (Jul 22, 2026): discretionary crypto vaults may implicate ICA/Securities/Advisers Acts; programmatic rules-encoded strategies are the safer end. IOSCO: auto-execution = discretionary portfolio management requiring authorization. Sequence: (1) own funds — fine; (2) offshore entity + non-US users + rules-encoded (not discretionary) strategy for the pooled vault; (3) non-custodial subaccounts as the lighter shape. US persons can't access tokenized stocks anyway — the SEC pulled the innovation exemption in May 2026 with no new timeline — so excluding them costs us nothing today. |
| **Derive platform risk** | Non-trivial | DAO whitelist gates listings; the 50% token mint governance drama shows the DAO can surprise. Mitigation is architectural: keep the strategy engine venue-agnostic so PowerTrade/Hyperliquid are a config change, not a rewrite. |
| **Oracle/settlement basis** | Underrated | Equity options on a 24/7 chain reference underlyings that trade 6.5 hours a day. Overnight/weekend basis between tokenized price and primary-market price creates settlement disputes and mark risk. Understand Derive's oracle design for equities *before* listing day; size conservatively around earnings and weekends. |

---

## 8. Kill criteria and next 14 days

**Kill it if:**
- 90 days of live ETH/BTC trading shows realized premium capture below ~60% of the Monte Carlo expectation after fees and slippage — the edge is theoretical, not real.
- Derive v3 equities slips past Q1 2027 **and** PowerTrade ships a vault first — the whitespace closed and we're a fast follower with no distribution.
- Regulatory: any indication the offshore + non-US structure doesn't actually hold for a solo US builder (counsel opinion, enforcement pattern) — no product is worth that.
- Phase 2 vault can't attract $1M of external, non-friend TVL within 90 days of launch — demand was optics, not real.

**Next 14 days:**

1. Deploy the agent on Derive testnet; validate order placement, roll logic, and Builder Code fee attachment end-to-end.
2. Fund the mainnet ETH/BTC account with own capital; first live epochs at 0.25 delta, 30-day tenor.
3. Ship v1 of the public track-record dashboard (trades, fills, PnL vs buy-hold, updated automatically).
4. Register the Builder Code and confirm the first 4-weekly payout mechanics with a live trade.
5. Get one hour with offshore counsel: entity jurisdiction shortlist + written read on the rules-encoded vs discretionary line for the pooled vault.
6. Open the Derive channel: reach the team/DAO about v3 equities timing, oracle design for market-close hours, and vault-builder whitelisting. Being known *before* listing day is half the moat.
7. Paper-trade the xStocks names on PowerTrade's feed to validate the NVDA/TSLA/AAPL premium numbers against a second venue's live IVs.

---

## Bottom line

The strategy edge is modest and honest — a few points over buy-hold — but the product demand is proven at $80B scale and the on-chain shelf is empty, which makes this a distribution race, not a research problem. Builder Codes plus my own capital mean the bet costs execution time, not money, and every week of live track record compounds into the only moat available before Derive or PowerTrade wake up. Ship Phase 1 now, be standing on Derive v3's doorstep on equities listing day, and kill it without sentiment if the live numbers or the window say to.
