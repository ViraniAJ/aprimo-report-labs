"use client"

/** Report Labs mark: a flask with three bars rising inside it. */
export function LabsMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path
        d="M12 3h8M13.5 3v8.2L5.6 24.6A3 3 0 0 0 8.2 29h15.6a3 3 0 0 0 2.6-4.4L18.5 11.2V3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9.2 20.5h13.6l2.9 5.3a1.4 1.4 0 0 1-1.2 2.1H7.5a1.4 1.4 0 0 1-1.2-2.1z" fill="var(--signal)" />
      <rect x="11" y="23.2" width="2.2" height="3.6" rx=".6" fill="var(--signal-foreground)" />
      <rect x="14.9" y="21.6" width="2.2" height="5.2" rx=".6" fill="var(--signal-foreground)" />
      <rect x="18.8" y="22.6" width="2.2" height="4.2" rx=".6" fill="var(--signal-foreground)" />
    </svg>
  )
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-foreground">
      <LabsMark />
      <span className="leading-none">
        <span className="block text-[15px] font-semibold tracking-tight">Report Labs</span>
        {!compact && <span className="block text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground mt-0.5">for Aprimo DAM</span>}
      </span>
    </span>
  )
}
