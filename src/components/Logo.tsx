export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#16325c" />
      <path d="M7 8h18l-7 8.5V23l-4 2v-8.5z" fill="none" stroke="#5eead4" strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="22.5" cy="21.5" r="3.2" fill="none" stroke="#fff" strokeWidth="1.8" />
      <path d="M24.8 23.8l2.2 2.2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ tagline = false }: { tagline?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark />
      <span className="leading-tight">
        <span className="block text-lg font-bold tracking-tight text-ink-900">Screen<span className="text-lens-700">Lab</span></span>
        {tagline && <span className="block text-xs text-slate-600">Systematic Review Screening, Simplified.</span>}
      </span>
    </span>
  );
}
