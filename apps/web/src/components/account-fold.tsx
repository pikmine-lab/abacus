'use client'

import { useState } from 'react'

/**
 * An account row that opens on what hangs from it: the cards that debit it.
 * The row stays the account (its name, its balance, its menu) and says how
 * many cards it carries; unfolding shows them. Same native `<details>` as the
 * position masses, animated in `globals.css`, and closed by default: the cards
 * are declared once and reread rarely, while the balances are what the page is
 * opened for.
 *
 * Belonging is said by distance and a hairline rail, as under a mass: the
 * cards sit tight under their row, indented, and the next account comes after
 * the divider.
 */
export function AccountFold({
  header,
  open,
  children,
}: {
  header: React.ReactNode
  /** Opens on load: a statement waiting for its debit day is work to do, never folded away. */
  open?: boolean
  children: React.ReactNode
}) {
  // Read once: after a validation re-renders the page, the row stays as the
  // person left it instead of folding under the hand that just used it.
  const [initiallyOpen] = useState(open)
  return (
    <details open={initiallyOpen} className="fold group/account">
      {/* The row's menu is not the fold's handle: a click on it opens the menu
          and leaves the cards as they are. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a summary is the
          handle of its details, keyboard included; the rule does not know it. */}
      <summary
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('[data-keeps-fold]')) event.preventDefault()
        }}
        className="flex cursor-pointer list-none items-center gap-3 py-3 [&::-webkit-details-marker]:hidden"
      >
        {header}
      </summary>
      <div className="relative pt-1 pb-5 pl-3.5">
        <span
          aria-hidden
          className="pointer-events-none absolute top-1 bottom-5 left-[5px] w-px rounded-full bg-input"
        />
        {children}
      </div>
    </details>
  )
}
