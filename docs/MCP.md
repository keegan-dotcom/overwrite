# Overwrite MCP — talk to your options agent from Claude

The MCP server turns the whole "download a YAML, follow terminal steps"
flow into a conversation. Claude quotes strategies, writes configs, runs
preflight and dry-run cycles, and reads your agent's status — while live
trading stays a deliberate human action in a terminal.

## Setup (once)

```bash
git clone https://github.com/keegan-dotcom/overwrite && cd overwrite
./install.sh              # or: pip install -r requirements.txt
```

**Claude Code:**

```bash
claude mcp add overwrite -- python3 -m agent.mcp_server
```

**Claude Desktop** (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "overwrite": {
      "command": "python3",
      "args": ["-m", "agent.mcp_server"],
      "cwd": "/absolute/path/to/overwrite"
    }
  }
}
```

Put your Derive keys in `.env` as usual (`DERIVE_WALLET`,
`DERIVE_SESSION_KEY`, `DERIVE_SUBACCOUNT_ID`) — the session key is a
one-time wallet signature and stays on your machine. The MCP server never
sees your seed phrase and cannot withdraw funds (session keys are
trading-scoped by Derive).

## What you can say

- *"Quote me 10% yield on my BTC, I'd sell above $120k, close if down 20%"*
  → `quote_strategy` returns strikes, premium, the tradeoffs, and the
  honesty check (if your cap can't pay your yield target, it says so).
- *"OK, set that up"* → `generate_config` writes `configs/income-btc.yaml`.
- *"Run preflight"* → the guided inspection; writes the go-live stamp only
  if everything passes.
- *"Do a dry run"* → one real decision cycle, orders forced off.
- *"How's my agent doing?"* → premium collected, orders, recent cycles.
- *"Take it live"* → Claude can only hand you the exact command. Going
  live is you, in a terminal, on purpose:
  `python3 -m agent.main run --config configs/income-btc.yaml --live`

## Safety model

| Action | Who |
|---|---|
| Quote, explain, disclose | MCP (Claude) |
| Write config (dry_run: true always) | MCP (Claude) |
| Preflight + stamp | MCP (Claude) — same gate as the CLI |
| One dry-run cycle | MCP (Claude) — dry_run forced on |
| Start the live loop | **Human, terminal only** |
| Kill switch | Human: `touch data/KILL` |

No MCP tool can place an order. The `--live` flag still requires
`dry_run: false` in the YAML **and** a preflight stamp fresher than 24h.
