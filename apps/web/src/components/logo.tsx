/**
 * The abacus mark: three rods, one active bead each, offset so the eye reads
 * a count rather than a pattern. Rods inherit currentColor so the mark sits in
 * whatever ink surrounds it; beads carry the copper accent, which is what makes
 * it recognisable at 16px. Kept in sync with app/icon.svg (the tab icon).
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g stroke="currentColor" strokeOpacity="0.8" strokeWidth="1.6" strokeLinecap="round">
        <path d="M4 7h16" />
        <path d="M4 12h16" />
        <path d="M4 17h16" />
      </g>
      <g fill="var(--primary)">
        <circle cx="15.5" cy="7" r="2.9" />
        <circle cx="8.5" cy="12" r="2.9" />
        <circle cx="17" cy="17" r="2.9" />
      </g>
    </svg>
  )
}
