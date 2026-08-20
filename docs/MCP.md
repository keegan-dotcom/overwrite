# Overwrite MCP — talk to your options agent from Claude

The MCP server turns the whole "download a YAML, follow terminal steps"
flow into a conversation. Claude quotes strategies, writes configs, runs
preflight and dry-run cycles, and reads your agent's status — while live
trading stays a deliberate human action in a terminal.

## Easiest: the plugin

**Claude app (Cowork/desktop — no terminal needed):** Customize → Plugins
→ Personal plugins → **+** → Add marketplace → *Add from a repository* →
`keegan-dotcom/overwrite` → Install.

**Claude Code terminal:**

```
/plugin marketplace add keegan-dotcom/overwrite
/plugin install overwrite@overwrite
```

That bundles the MCP server AND the operator skill (strategy knowledge,
guided setup, honesty rules). Then just say **"set up overwrite"** —
Claude runs `setup_check`, installs dependencies, creates `.env`, and
walks you through the one wallet step (creating a trading-scoped session
key on derive.xyz). You fill `.env` in your own editor — never paste keys
into chat.

## Manual: raw MCP server

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
sees your seed phrase. NOTE: a key that trades is admin-scoped (Derive
has no trade-only scope); it is revocable anytime and the plain withdraw
endpoint pays only to your own wallet.

## ChatGPT / Codex / any MCP client

MCP is an open standard — the same server works outside Claude. OpenAI
Codex (CLI, VS Code, or the Codex app), in `~/.codex/config.toml`:

```toml
[mcp_servers.overwrite]
command = "bash"
args = ["-lc", "cd /absolute/path/to/overwrite && python3 -m agent.mcp_server"]
```

Codex also reads this repo's `AGENTS.md` automatically — it carries the
same operator rules as the Claude skill (disclosures, no live trading,
setup flow). ChatGPT's web connectors require a *remote* MCP endpoint;
a hosted SSE endpoint is on the roadmap — until then use Codex locally.

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
