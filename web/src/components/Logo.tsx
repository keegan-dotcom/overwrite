export function LogoMark({ size = 30, dark = false }: { size?: number; dark?: boolean }) {
  const frame = dark ? "#F2EFE6" : "#161513";
  const bg = dark ? "#161513" : "#F2EFE6";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <rect width="64" height="64" fill={bg} />
      <rect x="4" y="4" width="56" height="56" fill="none" stroke={frame} strokeWidth="5" />
      {/* covered-call payoff: flat premium, capped past the strike */}
      <path
        d="M14 42 L30 42 L38 24 L50 24"
        stroke="#E8450A"
        strokeWidth="6"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

export function Logo({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <LogoMark dark={dark} />
      {!compact && (
        <span
          className={`font-display text-[1.25rem] uppercase tracking-[0.04em] ${
            dark ? "text-paper" : "text-ink"
          }`}
        >
          Overwrite
        </span>
      )}
    </span>
  );
}
