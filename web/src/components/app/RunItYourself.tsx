import { useState } from "react";
import { Quote } from "../../data/appdata";
import { VenueMode } from "../../data/venues";
import { RUNNABLE, downloadYaml, runSteps } from "../../lib/exporter";

/**
 * Post-approval handoff: download the generated agent config and run the
 * strategy from your own terminal - non-custodial, your keys, your machine.
 */
export function RunItYourself({ q, qty, mode }: { q: Quote; qty: number; mode: VenueMode }) {
  const [open, setOpen] = useState(false);
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
        <div className="flex gap-2">
          <button
            onClick={() => downloadYaml(q, qty, mode)}
            className="border-2 border-paper bg-accent px-3.5 py-1.5 font-mono text-[12px] font-bold uppercase text-ink shadow-hardsm transition-transform hover:-translate-x-px hover:-translate-y-px"
          >
            ⬇ Download config
          </button>
          <button
            onClick={() => setOpen(!open)}
            className="border-2 border-line px-3.5 py-1.5 font-mono text-[12px] uppercase text-fog transition-colors hover:border-fog hover:text-paper"
          >
            {open ? "Hide steps" : "Terminal steps"}
          </button>
        </div>
      </div>

      {open && (
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
