import { Reveal } from "./Reveal";
import { SectionHead } from "./SectionHead";

const PLUGIN_CMD = `/plugin marketplace add keegan-dotcom/overwrite
/plugin install overwrite@overwrite`;

const MCP_CMD = `git clone https://github.com/keegan-dotcom/overwrite && cd overwrite
./install.sh
claude mcp add overwrite -- python3 -m agent.mcp_server`;

const SAYINGS = [
  "“Quote me 10% yield on my BTC — I'd sell above $120k, close if down 20%.”",
  "“OK, set that up and run preflight.”",
  "“Do a dry run first.”",
  "“How's my agent doing this month?”",
];

/** The distribution hook: add an options desk to your Claude in one line. */
export function WorksWithClaude() {
  return (
    <section id="claude" className="mx-auto max-w-6xl px-5 py-24">
      <SectionHead
        no="06"
        kicker="Works with Claude"
        title={<>An options desk inside your Claude<span className="text-accent">.</span></>}
      />
      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <Reveal>
          <div className="flex h-full flex-col border-2 border-paper p-6">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-accent">
              Install once
            </p>
            <h3 className="mt-2 font-display text-xl uppercase">As a Claude plugin</h3>
            <p className="mt-3 font-serif text-[14px] leading-relaxed text-paper/85">
              <span className="font-bold text-paper">Claude app (Cowork):</span>{" "}
              Customize → Plugins → Personal plugins → <span className="font-mono text-[13px]">+</span> Add
              marketplace → Add from a repository →{" "}
              <span className="font-mono text-[13px] text-mint">keegan-dotcom/overwrite</span> → Install.
            </p>
            <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.1em] text-fog">
              or in the Claude Code terminal:
            </p>
            <pre className="mt-2 overflow-x-auto border border-line bg-pane px-4 py-3 font-mono text-[12.5px] leading-relaxed text-paper">{PLUGIN_CMD}</pre>
            <p className="mt-3 font-serif text-[14px] leading-relaxed text-paper/75">
              Either way it bundles the MCP server and the operator skill — Claude
              learns the strategies, the runbook, and the honesty rules the moment
              it installs.
            </p>
            <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.1em] text-fog">
              or raw MCP, one line after clone:
            </p>
            <pre className="mt-2 overflow-x-auto border border-line bg-pane px-4 py-3 font-mono text-[12.5px] leading-relaxed text-paper">{MCP_CMD}</pre>
            <p className="mt-3 font-serif text-[13px] leading-snug text-paper/70">
              MCP is an open standard — the same server plugs into{" "}
              <span className="text-paper">OpenAI Codex</span> (and any MCP client),
              with the repo's AGENTS.md carrying the same operator rules.
            </p>
          </div>
        </Reveal>
        <Reveal delay={1}>
          <div className="flex h-full flex-col border-2 border-paper p-6">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-accent">
              Then just talk
            </p>
            <h3 className="mt-2 font-display text-xl uppercase">Plain English in, structured trades out</h3>
            <ul className="mt-4 space-y-2.5">
              {SAYINGS.map((s) => (
                <li key={s} className="border-l-2 border-accent pl-3 font-serif text-[15px] italic leading-snug text-paper/85">
                  {s}
                </li>
              ))}
            </ul>
            <p className="mt-auto pt-5 font-serif text-[14px] leading-relaxed text-paper/75">
              Claude quotes with full disclosure, writes the config, runs the
              preflight inspection and dry-run cycles, and reads your premium
              ledger. <span className="text-accent">No MCP tool can place an
              order</span> — going live is you, in a terminal, on purpose, behind
              the preflight gate. Your keys stay on your machine.
            </p>
            <p className="mt-3 font-mono text-[12px] uppercase tracking-[0.1em]">
              <a href="/app" className="text-accent underline decoration-2 underline-offset-4 hover:text-paper">Try the demo first →</a>
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
