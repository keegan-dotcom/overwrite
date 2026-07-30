export function LogoMark({ size = 30 }: { size?: number; dark?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <rect width="64" height="64" fill="#0A0E0D" />
      <rect x="4" y="4" width="56" height="56" fill="none" stroke="#E9F2EC" strokeWidth="5" />
      {/* covered-call payoff: flat premium, capped past the strike */}
      <path
        d="M14 42 L30 42 L38 24 L50 24"
        stroke="#3DFFA8"
        strokeWidth="6"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

export function Logo({ compact = false }: { dark?: boolean; compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <LogoMark />
      {!compact && (
        <span className="font-display text-[1.25rem] uppercase tracking-[0.04em] text-paper">
          Overwrite
        </span>
      )}
    </span>
  );
}
