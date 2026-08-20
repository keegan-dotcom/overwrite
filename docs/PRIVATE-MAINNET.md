# Private mainnet instance — how it works

Project: `overwrite-private` (`xceljobykjsslgnurogp.supabase.co`), pinned to
**Derive MAINNET** in the deployed functions (the repo copies stay
env-driven and default to testnet). Fleet cron every 15 min. REAL MONEY.

Engine per tenant: covered calls on `config.symbol` (default **ETH**,
delta 0.25, 7–45d, post-only) + premium router sweeping idle USDC into
**BTC-USDC** spot (IOC, ≤$250/cycle). Caps: `max_order` 1 ETH,
20 orders/day. New tenants default `live: true` — **registering the
session key on Derive is the owner's authorization to trade**; trading
starts on the next 15-minute cycle after activation.

## The share link (whitelisted users only)
```
https://overwrite.pro/app?instance=private&ikey=<console_key>
```
The link flips the app onto this instance (persists in the browser;
`?net=public` resets). A "PRIVATE MAINNET · REAL FUNDS" chip replaces the
demo badge. Enrollment is server-side allowlist-gated, so the link itself
only grants read access via the console key.

## User flow (you and each whitelisted friend)
1. Open the share link → accept the terms gate.
2. Connect wallet → open **24/7 hosted** after deploying a strategy
   (or straight from the ticket footer).
3. Enter your MAINNET Derive "Wallet" address (app.derive.xyz →
   Developers — not the Signer address) → **Go 24/7**.
4. Register the shown session key at app.derive.xyz → Developers →
   scope **account**, name ≤16 chars → "I registered it → activate".
5. Done. First quote goes out within 15 minutes. Watch it in the Console tab.

## Allowlist (who may enroll)
`fleet_config.allowlist` — comma-separated EOAs or Derive wallets,
case-insensitive; tenant count capped at list length. Add someone:
```sql
update fleet_config set value = value || ',0xTHEIR_ADDRESS' where key='allowlist';
```

## Kill switches
- Per user: `update tenants set kill = true where derive_wallet ilike '0x…';`
- Per user, softer: set `config.live` to `false` (dry-run: logs exact orders, places none)
- Owner-side absolute: revoke the session key at app.derive.xyz → Developers
- Whole instance: `select cron.unschedule('overwrite-fleet-15m');`

## Custody note (accepted tradeoff, on the record)
The keystore secret is embedded in the deployed function code (owner opted
out of dashboard-managed secrets), so compromise of the Supabase account
could trade — never withdraw — enrolled accounts. Recovery copy of the
secret is held by the owner. Config changes per tenant:
```sql
update tenants set config = config || '{"max_order": 0.5}' where derive_wallet ilike '0x…';
```
