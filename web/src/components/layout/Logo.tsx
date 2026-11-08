/** Original FitCheck-In mark: a check stroke rising out of a pulse ring. */
export function Logo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <defs>
        <linearGradient id="fc-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#38bdf8" />
          <stop offset="0.55" stopColor="#0a84a6" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="38" height="38" rx="12" fill="url(#fc-g)" />
      <rect x="1.5" y="1.5" width="37" height="37" rx="11.5" fill="none" stroke="white" strokeOpacity="0.35" />
      <path d="M8 21h5l3-6 4 12 3-7h3l4-6" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <Logo className="size-8" />
      <span className="font-display text-lg font-semibold tracking-tight text-ink">
        FitCheck<span className="text-accent">-In</span>
      </span>
    </span>
  )
}
