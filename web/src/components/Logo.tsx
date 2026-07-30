export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <rect width="64" height="64" rx="14" fill="#0A0E0D" stroke="#1E2A26" />
      {/* covered-call payoff: flat premium, then capped at the strike */}
      <path
        d="M14 40 L30 40 L38 24 L50 24"
        stroke="#3DFFA8"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="14" cy="40" r="4" fill="#3DFFA8" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <LogoMark />
      {!compact && (
        <span className="font-display text-[1.35rem] font-medium tracking-tight text-paper">
          Overwrite
        </span>
      )}
    </span>
  );
}
