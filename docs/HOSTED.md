# Overwrite Hosted — Path B spec

*The "connect a session key, pick your delta, we run the loop" product.
Draft v1, July 2026. Prerequisite reading: BUSINESS.md (paths A/B/C).*

## Product

One page after login: connect Derive session key → choose per-asset delta
(0.15 / 0.25 / 0.30) and utilization → toggle ON. Dashboard shows resting
quotes, fills, premium ledger, and every risk-rail event. Email/Telegram
alerts on fills, defensive rolls, and pauses. That's the whole surface.

**The custody line that makes this product possible:** users register a
session key on their own Derive subaccount. NOTE: Derive v2 has no
trade-only scope - the key must be admin-scoped to place orders, which also
permits withdraw/transfer. The plain withdraw endpoint has no recipient
parameter (pays only to the owner's wallet), and the key is revocable
anytime. Do NOT claim it "cannot withdraw".
Users revoke the key in the Derive UI at any time - that's their kill switch,
independent of us. No deposits, no pooling, no NAV.

## Architecture

```
user browser ── Next.js app (Vercel) ── Postgres (users, configs, key refs)
                        │
                 control API (FastAPI)
                        │
              agent fleet: 1 process per user-subaccount
              (the OSS agent, unmodified, config injected)
                        │
                 Derive testnet/mainnet
```

- **Fleet runner:** each user = one container/process running the exact
  open-source agent with a generated YAML + env. No shared state between
  users; a crash affects one user. Supervisor (Nomad/systemd/K8s) restarts.
  ~256MB per agent → hundreds of users per box; this does not need to be
  clever for a long time.
- **Session-key storage:** the only secret we hold. KMS-encrypted at rest
  (AWS KMS or Vault transit), decrypted only inside the runner process,
  never logged, never in Postgres plaintext. Rotation = user re-registers
  key, we swap. Document the threat model publicly - it's a selling point.
- **Status plumbing:** each agent writes status.json → aggregator →
  per-user dashboard + a public opt-in leaderboard (track-record marketing).
- **Same rails, forced on:** hosted configs pin `dry_run` off only after a
  first supervised cycle, cap `max_utilization` ≤ 0.9, keep maker-mode
  deviation bounds; per-user KILL from the dashboard writes the kill file.

## Pricing (launch hypothesis)

- **Free:** testnet, one asset, community support. Funnel + track record.
- **Pro $29/mo:** mainnet, all assets, alerts, priority parameters.
- **Plus builder-code flow:** `extra_fee` ~$0.05/contract on all hosted
  trades (disclosed). At 100 Pro users ≈ $35k/yr subs before flow revenue.
- No performance fees at launch: perf fees on someone else's account is
  exactly the fact pattern that reads as investment management. Revisit
  with counsel only.

## Legal questions for counsel (before mainnet US users)

1. Running a rules-encoded agent on a user's delegated, non-custodial,
   admin-scoped key, with parameters chosen by the user: does this cross
   into discretionary investment management / IAA "advice" (IOSCO FR/06/2025
   treats auto-execution as discretionary in most regimes)? Does the user
   selecting all parameters + revocable key change the analysis?
2. Flat SaaS fee vs per-trade builder fee vs performance fee: which fee
   shapes change the answer to (1)?
3. Geo-fencing obligations if underlyings later include tokenized equities
   (currently US-blocked at issuer level anyway).
4. Marketing constraints: publishing gross premium yields with the
   premium-≠-total-return disclosure - adequate? Track-record/leaderboard
   rules?
5. Entity: does an offshore opco for hosted (mirroring the vault plan) buy
   anything while founders are US persons? (Honest expectation: not much.)

## Build order (~2-3 weeks of evenings)

1. Waitlist (live on the site) → gauge demand. **Gate: ≥25 signups.**
2. Single-tenant hosted alpha: run YOUR agent on a $10 VPS with systemd +
   status.json → public dashboard. This is "hosted" with n=1 and proves ops.
3. Key vault + config generator + fleet supervisor (n=10, invite-only,
   testnet first, friends from 4RC).
4. Stripe + alerts + onboarding polish → open beta.

## Kill criteria

- <25 waitlist signups in 4 weeks → stay Path A (OSS + builder codes).
- Counsel says delegated-key automation = registered-adviser territory with
  no practical structure → hosted becomes "deploy to YOUR VPS in one click"
  (sell the installer, never touch keys).
- Derive ships a native strategy-automation product → pivot to being its
  best strategy, not its infrastructure.
