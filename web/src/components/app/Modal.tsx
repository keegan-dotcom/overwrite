import { ReactNode, useEffect } from "react";

export function Modal({
  title, onClose, children,
}: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col border-2 border-paper bg-ink shadow-hard">
        <div className="flex items-center justify-between border-b-2 border-line px-4 py-2.5">
          <span className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-paper">{title}</span>
          <button onClick={onClose}
            className="border border-line px-2 py-0.5 font-mono text-[11px] uppercase text-fog hover:border-fog hover:text-paper">
            esc ✕
          </button>
        </div>
        <div className="overflow-y-auto p-3">{children}</div>
      </div>
    </div>
  );
}
