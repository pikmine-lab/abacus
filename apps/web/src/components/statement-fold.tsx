'use client'

import { ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'

/**
 * One statement of a card's page and the purchases it groups. The same native
 * `<details>` as the account rows and the position masses: a statement waiting
 * for its debit opens, since validating it is work to do and its purchases are
 * what the total is checked against; a validated one stays folded, a history
 * one opens on demand.
 *
 * The header carries the validation, which is not the fold's handle: clicking
 * it opens its dialog and leaves the statement as it was.
 */
export function StatementFold({
  id,
  open,
  header,
  figures,
  children,
}: {
  /** Anchor, so a total elsewhere leads straight to its statement. */
  id: string
  open: boolean
  /** What the cycle is and where it stands. */
  header: React.ReactNode
  /** The total and the validation, at the end of the header row. */
  figures: React.ReactNode
  children: React.ReactNode
}) {
  // Read once: after a validation re-renders the page, the statement stays as
  // the person left it.
  const [initiallyOpen] = useState(open)
  return (
    <details id={id} open={initiallyOpen} className="fold group/statement scroll-mt-28">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a summary is the
          handle of its details, keyboard included; the rule does not know it. */}
      <summary
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('[data-keeps-fold]')) event.preventDefault()
        }}
        className="flex cursor-pointer list-none items-center gap-3 py-3 [&::-webkit-details-marker]:hidden"
      >
        <ChevronRightIcon className="size-3 shrink-0 text-faint transition-transform group-open/statement:rotate-90" />
        <div className="flex min-w-0 flex-col gap-0.5">{header}</div>
        <div data-keeps-fold className="ml-auto flex shrink-0 items-center gap-3">
          {figures}
        </div>
      </summary>
      <div className="relative flex flex-col divide-y divide-border/70 pb-4 pl-3.5">
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-4 left-[5px] w-px rounded-full bg-input"
        />
        {children}
      </div>
    </details>
  )
}
