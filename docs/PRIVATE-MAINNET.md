# Private mainnet instance — activation runbook

Infrastructure is deployed and **dormant**. Project: `overwrite-private`
(`xceljobykjsslgnurogp.supabase.co`), single-tenant, cron every 15 min.
It runs in TESTNET mode and refuses to trade until YOU complete the steps
below, in order. Real money — read each step before doing it.

Engine: covered calls on `config.symbol` (default **XAUT**) + premium
router sweeping idle USDC into **BTC-USDC** spot. Post-only maker quotes,
per-day order budget, per-cycle sweep cap, `live:false` dry-run default.

## Step 0 — know the risks (once more)
- The mainnet session key lives AES-GCM-encrypted in this project's DB.
  The encryption key derives from `KEYSTORE_SECRET`, which only you set and
  which is never stored in the database — but a full compromise of your
  Supabase account could still TRADE (never withdraw) this subaccount.
- XAUT options launched 2026-07-24 and the book is thin (sampled OTM calls
  showed zero live bids). Post-only quotes may sit unfilled for a long time.
  Size accordingly; `max_order` defaults to 0.5 XAUT.

## Step 1 — set the function secrets (BEFORE enrolling)
Supabase dashboard → `overwrite-private` → Edge Functions → Secrets:
- `DERIVE_ENV` = `prod`
- `KEYSTORE_SECRET` = a long random string you generate and keep
  (e.g. `openssl rand -hex 32` in Terminal). Losing it = re-enroll.

Order matters: a key enrolled before `KEYSTORE_SECRET` exists is encrypted
with the wrong key and becomes undecryptable when you set it.

## Step 2 — fund the mainnet account
1. app.derive.xyz → create/sign in to your MAINNET account.
2. Deposit XAUT (and a little USDC) into your subaccount.
3. Developers page → copy the **Wallet** address (not Signer).

## Step 3 — enroll and authorize the key
```bash
# get the fleet's session key address (generates + stores it encrypted)
curl -s -X POST https://xceljobykjsslgnurogp.supabase.co/functions/v1/overwrite-enroll \
  -H 'content-type: application/json' \
  -d '{"action":"enroll","owner_eoa":"<YOUR_EOA>","derive_wallet":"<DERIVE_WALLET>"}'
```
Register the returned `session_key_address` at app.derive.xyz → Developers →
Register Session Key — **scope: account** (trading only), name ≤16 chars.
Then:
```bash
curl -s -X POST .../overwrite-enroll -H 'content-type: application/json' \
  -d '{"action":"activate","derive_wallet":"<DERIVE_WALLET>"}'
```

## Step 4 — watch DRY cycles (recommended: at least a few hours)
Every 15 min the fleet logs the EXACT order it would place, placing nothing:
```bash
# console key (printed once): SQL editor → select value from fleet_config where key='console_key';
curl -s "https://xceljobykjsslgnurogp.supabase.co/functions/v1/overwrite-status?wallet=<DERIVE_WALLET>&key=<CONSOLE_KEY>"
```
Look for `DRY (live:false) - would quote SELL …` and `DRY sweep - would BUY …`
and sanity-check strikes, sizes, prices.

## Step 5 — go live (the switch is yours)
SQL editor:
```sql
update tenants set config = jsonb_set(config, '{live}', 'true');
```

## Kill switches (any of these stops it)
- `update tenants set kill = true;`            -- instant, keeps state
- `update tenants set config = jsonb_set(config, '{live}', 'false');` -- back to dry-run
- Revoke the session key at app.derive.xyz → Developers  -- venue-level, absolute
- `select cron.unschedule('overwrite-fleet-15m');`        -- stops the clock

## Config reference (tenants.config)
`symbol` XAUT | ETH | BTC · `dte_min/max` expiry window · `delta_target`
strike selection · `min_yield` annualized floor · `min_order/max_order`
contracts · `max_orders_per_day` quote budget ·
`sweep.buy` BTC (or null to disable) · `sweep.keep_usdc_float` USDC kept ·
`sweep.min_sweep_usd` / `sweep.max_sweep_usd` per-cycle bounds · `live` the switch.

## Allowlist — who may enroll
Enrollment is closed: only addresses in the `allowlist` row of
`fleet_config` (comma-separated, EOA or Derive wallet, case-insensitive)
can enroll, and the tenant count is capped at the list length. Your EOA
(`0x2473…BeaA`) is pre-seeded. To add a friend:
```sql
update fleet_config
set value = value || ',0xFRIEND_EOA_OR_DERIVE_WALLET'
where key = 'allowlist';
```
Each friend goes through the same Step 3 flow with their own wallet, gets
their own session key (registered and revocable only by them), their own
isolated tenant row, and their own `live` flag. Before letting anyone
trade real money here: have them read overwrite.pro/security and accept
the same terms the public app gates on - and remember my standing
recommendation of a third-party audit before third-party funds.

## Private web console (optional)
Deploy a second Vercel project from this repo with env:
`VITE_FN_BASE=https://xceljobykjsslgnurogp.supabase.co/functions/v1` and
`VITE_CONSOLE_KEY=<console_key>` — the app's Console then reads this instance.
