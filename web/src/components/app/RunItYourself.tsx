import { useState } from "react";
import { Quote } from "../../data/appdata";
import { VenueMode } from "../../data/venues";
import { RUNNABLE, downloadYaml, runSteps } from "../../lib/exporter";

/**
 * Post-approval handoff: download the generated agent config and run the
 * strategy from your own terminal - non-custodial, your keys, your machine.
 */
const MCP_SNIPPET = `# easiest: talk to the agent from Claude instead of raw terminal
git clone https://github.com/keegan-dotcom/overwrite && cd overwrite
./install.sh
claude mcp add overwrite -- python3 -m agent.mcp_server`;

const MCP_DESKTOP = `{
  "mcpServers": {
    "overwrite": {
      "command": "python3",
      "args": ["-m", "agent.mcp_server"],
      "cwd": "/path/to/overwrite"
    }
  }
}`;

export function RunItYourself({ q, qty, mode }: { q: Quote; qty: number; mode: VenueMode }) {
  const [open, setOpen] = useState<false | "terminal" | "claude">(false);
  const runnable = RUNNABLE.has(q.strategyId);
  const steps = runSteps(q);

  return (
    <div className="border-2 border-line bg-pane">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-mint">
            Run it yourself · open-source agent
          </div>
          <div className="font-serif text-[12.5px] leading-snug text-fog">
            {runnable
              ? "This strategy runs on the MIT-licensed agent from your own terminal - your keys never leave your machine."
              : "This strategy exports as a captured spec - the open-source agent runs the covered-call family today; this engine is on the roadmap."}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setOpen(open === "claude" ? false : "claude")}
            className={`border-2 px-3.5 py-1.5 font-mono text-[12px] font-bold uppercase shadow-hardsm transition-transform hover:-translate-x-px hover:-translate-y-px ${
              open === "claude" ? "border-mint bg-ink text-mint" : "border-paper bg-accent text-ink"
            }`}
          >
            ✳ Use with Claude
          </button>
          <button
            onClick={() => downloadYaml(q, qty, mode)}
            className="border-2 border-line px-3.5 py-1.5 font-mono text-[12px] uppercase text-fog transition-colors hover:border-fog hover:text-paper"
          >
            ⬇ Download config
          </button>
          <button
            onClick={() => setOpen(open === "terminal" ? false : "terminal")}
            className="border-2 border-line px-3.5 py-1.5 font-mono text-[12px] uppercase text-fog transition-colors hover:border-fog hover:text-paper"
          >
            {open === "terminal" ? "Hide steps" : "Terminal steps"}
          </button>
        </div>
      </div>

      {open === "claude" && (
        <div className="space-y-3 border-t-2 border-line px-4 py-3">
          <div className="font-serif text-[13px] leading-snug text-paper/90">
            The agent ships as an <span className="text-mint">MCP server</span> — connect
            it once and manage everything by talking to Claude: <em>"quote 10% on my BTC,
            sell above $120k"</em>, <em>"run preflight"</em>, <em>"do a dry run"</em>,{" "}
            <em>"how's my agent doing?"</em>. Claude quotes, configures, inspects and
            monitors; <span className="text-amber">going live stays a human step in your
            terminal</span> — no MCP tool can place an order.
          </div>
          <div>
            <div className="mb-1 font-mono text-[11px] text-fog">Claude Code (one line):</div>
            <pre className="overflow-x-auto border border-line bg-ink px-3 py-2 font-mono text-[11.5px] leading-relaxed text-paper">{MCP_SNIPPET}</pre>
          </div>
          <div>
            <div className="mb-1 font-mono text-[11px] text-fog">Claude Desktop (Settings → Developer → Edit Config):</div>
            <pre className="overflow-x-auto border border-line bg-ink px-3 py-2 font-mono text-[11.5px] leading-relaxed text-paper">{MCP_DESKTOP}</pre>
          </div>
          <div className="font-serif text-[12px] italic leading-snug text-fog">
            One-time wallet step still applies: your Derive session key (a trading-scoped
            signature that can't withdraw) goes in .env on your machine. Full guide: docs/MCP.md in the repo.
          </div>
        </div>
      )}

      {open === "terminal" && (
        <div className="space-y-3 border-t-2 border-line px-4 py-3">
          {steps.map((s, i) => (
            <div key={i}>
              <div className="mb-1 font-mono text-[11px] text-fog">
                {i + 1}. {s.title}
              </div>
              <pre className="overflow-x-auto border border-line bg-ink px-3 py-2 font-mono text-[11.5px] leading-relaxed text-paper">
                {s.cmd}
              </pre>
            </div>
          ))}
          <div className="font-serif text-[12px] italic leading-snug text-fog">
            Dry-run is the default and --live refuses to start without a fresh
            preflight stamp. Testnet first. Audit the code with your own AI
            before running it - it's your money and your machine.
          </div>
        </div>
      )}
    </div>
  );
}
