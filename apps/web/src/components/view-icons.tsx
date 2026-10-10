/*
 * The Analyse's readings as icons: each one the bare shape of its drawing,
 * coarse enough to read at a glance. They take the current colour, so the
 * active tab colours its drawing.
 */

const SIZE = { width: 16, height: 16, viewBox: '0 0 16 16' }

/** One bar cut into a few shares. */
export function StripIcon() {
  return (
    <svg aria-hidden {...SIZE} fill="currentColor">
      <rect x="0" y="4" width="8" height="8" rx="1.5" />
      <rect x="9.5" y="4" width="3.5" height="8" rx="1.5" />
      <rect x="14.5" y="4" width="1.5" height="8" rx="0.75" />
    </svg>
  )
}

/** One bar per line, shortening down the ranking. */
export function BarsIcon() {
  return (
    <svg aria-hidden {...SIZE} fill="currentColor">
      <rect x="0" y="1" width="16" height="4" rx="1.5" />
      <rect x="0" y="6" width="11" height="4" rx="1.5" />
      <rect x="0" y="11" width="6" height="4" rx="1.5" />
    </svg>
  )
}

/** One large block beside two smaller ones. */
export function MapIcon() {
  return (
    <svg aria-hidden {...SIZE} fill="currentColor">
      <rect x="0" y="1" width="9" height="14" rx="1.5" />
      <rect x="10.5" y="1" width="5.5" height="7.5" rx="1.5" />
      <rect x="10.5" y="10" width="5.5" height="5" rx="1.5" />
    </svg>
  )
}
