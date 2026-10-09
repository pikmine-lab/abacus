'use client'

import { ChevronRightIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A kind of recurring expense inside its account, folding away on its own.
 * Same native `<details>` as the masses and the folded sections, animated in
 * `globals.css`: open by default, since folding is a gesture one asks for, and
 * no state remembers it. The header is laid on the list's own columns by the
 * caller; a control in it (an order) is marked `data-keeps-fold` so that a
 * click on it opens its menu without folding the list under it.
 */
export function ExpenseFold({
  header,
  className,
  children,
}: {
  /** The summary's content; it gets the chevron through `FoldChevron`. */
  header: React.ReactNode
  /** The summary's own layout: the list's columns. */
  className?: string
  children: React.ReactNode
}) {
  return (
    <details open className="fold group/kind">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a summary is the
          handle of its details, keyboard included; the rule does not know it. */}
      <summary
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('[data-keeps-fold]')) event.preventDefault()
        }}
        className={cn('cursor-pointer list-none [&::-webkit-details-marker]:hidden', className)}
      >
        {header}
      </summary>
      {children}
    </details>
  )
}

export function FoldChevron() {
  return (
    <ChevronRightIcon
      aria-hidden
      className="size-3.5 shrink-0 self-center text-faint transition-transform group-open/kind:rotate-90"
    />
  )
}
