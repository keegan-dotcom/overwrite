import { useEffect, useRef, useState } from "react";
import { SUGGESTED_PROMPTS } from "../../lib/intent";
import type { ChatMsg } from "./types";

export function IntentChat({
  messages, onSend, thinking, defaultsNote,
}: {
  messages: ChatMsg[];
  onSend: (text: string) => void;
  thinking: boolean;
  defaultsNote?: string | null;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  const submit = () => {
    const t = draft.trim();
    if (!t || thinking) return;
    setDraft("");
    onSend(t);
  };

  return (
    <div className="flex h-full min-h-[420px] flex-col border-2 border-line bg-pane">
      <div className="border-b-2 border-line px-4 py-2.5">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-fog">
          Tell the agent what you want
        </div>
        <div className="font-serif text-[12.5px] italic text-fog">
          No greeks needed. A good ask: <span className="not-italic font-mono text-[11px]">asset + goal + limits + horizon</span>
        </div>
        {defaultsNote && (
          <div className="mt-1 inline-block border border-mint/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-mint">
            remembers you: {defaultsNote}
          </div>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[92%] border-2 px-3 py-2 ${
                m.role === "user"
                  ? "border-paper bg-ink text-paper"
                  : "border-mint/50 bg-ink text-paper"
              }`}
            >
              {m.role === "agent" && (
                <div className="mb-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-mint">
                  overwrite agent
                </div>
              )}
              <div className="font-serif text-[13.5px] leading-snug">{m.text}</div>
              {m.bullets && m.bullets.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 font-mono text-[11.5px] text-fog">
                  {m.bullets.map((b, j) => (
                    <li key={j}>· {b}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex justify-start">
            <div className="border-2 border-mint/50 bg-ink px-3 py-2 font-mono text-[12px] text-mint">
              structuring<span className="animate-pulse">…</span>
            </div>
          </div>
        )}
      </div>

      {messages.length <= 1 && (
        <div className="flex flex-wrap gap-1.5 border-t-2 border-line px-3 py-2">
          {SUGGESTED_PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => onSend(p)}
              className="border border-line px-2 py-1 text-left font-mono text-[10.5px] text-fog transition-colors hover:border-mint hover:text-mint"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 border-t-2 border-line p-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder='"ETH · 12% yield · stop at 15% · monthly"'
          className="min-w-0 flex-1 border-2 border-line bg-ink px-3 py-2 font-mono text-[13px] text-paper placeholder:text-fog/60 focus:border-mint focus:outline-none"
        />
        <button
          onClick={submit}
          className="border-2 border-paper bg-accent px-4 font-mono text-[13px] font-bold uppercase text-ink shadow-hardsm transition-transform hover:-translate-x-px hover:-translate-y-px"
        >
          Send
        </button>
      </div>
    </div>
  );
}
