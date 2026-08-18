# Overwrite — agent operating guide

*This file is read automatically by OpenAI Codex and other AGENTS.md-aware
tools. Claude users get the same guidance via the bundled plugin skill
(`skills/overwrite-desk/SKILL.md`). Both wrap the same MCP server.*

Overwrite is an intent-based options agent on Derive: the user speaks
plain English ("earn 10% on my BTC, sell above $120k, close if down 20%"),
the tools do the math and the work.

## Connect the MCP server

Codex CLI (`~/.codex/config.toml`):

```toml
[mcp_servers.overwrite]
command = "bash"
args = ["-lc", "cd /absolute/path/to/overwrite && python3 -m agent.mcp_server"]
```

or: `codex mcp add overwrite --command bash --args -lc "cd /absolute/path/to/overwrite && python3 -m agent.mcp_server"`

Tools: `setup_check`, `quote_strategy`, `generate_config`, `preflight`,
`dry_run_once`, `agent_status`, `go_live_instructions`.
(No MCP available? The CLI does everything: `python3 -m agent.main --help`.)

## Hard rules (identical for every AI operator)

1. **Never summarize away tradeoffs.** Every quote includes `tradeoffs`
   and sometimes an `honesty_check` (e.g. "your $120k cap only pays
   2.6%/yr, not 10%"). Surface all of them, every time; lead with the
   honesty check when it fires.
2. **Never handle secrets.** Keys go into `.env` via the user's own
   editor, never through chat. If a user pastes a key, tell them to
   rotate it.
3. **Never start live trading.** No tool can. `go_live_instructions`
   returns the exact terminal command for the HUMAN to run. This is the
   design; say so.
4. **Dry-run before live, preflight before dry-run.** `preflight` writes
   the 24h stamp that `--live` requires; `dry_run_once` forces orders off.

## Plug-and-play setup flow

1. `setup_check` → fix what it lists: `python3 -m pip install -r
   requirements.txt` (needs Python 3.10–3.13); `cp .env.example .env`.
2. Derive testnet onboarding (guide the user; full detail in
   `skills/overwrite-desk/SKILL.md` and `docs/RUNBOOK.md`): connect a
   wallet at testnet.derive.xyz and sign to enable trading (creates their
   Derive smart-contract wallet + subaccount) → get Sepolia ETH from any
   public faucet → use the testnet drip INSIDE the deposit flow for USDC
   + the asset to overwrite → create a trading-scoped session key
   (Developers → Session Keys; it can trade, never withdraw) → fill
   `DERIVE_WALLET` (the smart-contract wallet, not their EOA),
   `DERIVE_SESSION_KEY`, `DERIVE_SUBACCOUNT_ID` in `.env` themselves.
3. `quote_strategy` from their words → `generate_config` → `preflight`
   → `dry_run_once` (narrate the decision) → hand over the live command.

## Strategy map

income = covered call (RUNNABLE) · neutral = delta-hedged covered call
(RUNNABLE; perp hedge is roadmap — always say so) · wheel = cash-secured
put · shield = protective put · collar · bear = put spread (these four
generate SPEC configs, underlying disabled — be explicit).

## Honest-yield framing (non-negotiable)

Premium yield ≠ total return. Covered calls keep downside and cap upside;
the edge is the volatility risk premium — real but modest. Never promise
APY. Kill switch: `touch data/KILL`.
