-- ============================================================================
-- Overwrite PRIVATE instance - one-shot setup for a fresh Supabase project.
-- Single-tenant, mainnet-capable, dormant until the owner activates it.
--
-- Applied via MCP/dashboard SQL editor. Safe to re-run (idempotent-ish).
-- The functions default to TESTNET until the owner sets the DERIVE_ENV=prod
-- and KEYSTORE_SECRET function secrets - see docs/PRIVATE-MAINNET.md.
-- ============================================================================
create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---- schema (mirror of the pilot project) ---------------------------------
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  owner_eoa text not null,
  derive_wallet text not null unique,
  subaccount_id bigint,
  session_key_address text not null,
  session_key_enc text not null,
  status text not null default 'awaiting_registration',
  kill boolean not null default false,
  -- XAUT covered calls, premium swept into BTC. live:false = DRY RUN:
  -- every cycle logs the exact order it WOULD place, places nothing.
  config jsonb not null default '{
    "symbol": "XAUT", "dte_min": 5, "dte_max": 45,
    "delta_target": 0.25, "min_yield": 0.03, "iv_fallback": 0.15,
    "min_order": 0.05, "max_order": 0.5, "max_orders_per_day": 20,
    "take_profit_pct": 0.75, "live": false,
    "sweep": {"buy": "BTC", "keep_usdc_float": 100,
              "min_sweep_usd": 25, "max_sweep_usd": 500}
  }'::jsonb,
  last_cycle_at timestamptz,
  last_error text,
  last_trade_sync_ms bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.ledger (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ts timestamptz not null default now(),
  kind text not null,
  instrument text,
  usd numeric,
  detail jsonb
);
create table if not exists public.cycles (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ts timestamptz not null default now(),
  ok boolean not null default true,
  msg text
);
create table if not exists public.fleet_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- deny-all RLS: only the service role (edge functions) reads these
alter table public.tenants enable row level security;
alter table public.ledger enable row level security;
alter table public.cycles enable row level security;
alter table public.fleet_config enable row level security;

-- ---- secrets: generated in-database, never in code or the repo ------------
insert into public.fleet_config (key, value)
values ('fleet_secret', encode(gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;
-- console key: required to READ status once DERIVE_ENV=prod (real positions
-- are not public). Fetch it once via the SQL editor:
--   select value from fleet_config where key = 'console_key';
insert into public.fleet_config (key, value)
values ('console_key', encode(gen_random_bytes(18), 'hex'))
on conflict (key) do nothing;

-- ---- schedule: every 15 minutes, secret read at fire time ------------------
-- NOTE: replace PROJECT_REF before running if applying manually.
select cron.unschedule('overwrite-fleet-15m')
where exists (select 1 from cron.job where jobname = 'overwrite-fleet-15m');
select cron.schedule(
  'overwrite-fleet-15m',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://PROJECT_REF.supabase.co/functions/v1/overwrite-fleet',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-fleet-secret', (select value from public.fleet_config where key = 'fleet_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
