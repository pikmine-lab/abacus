import type { AssetNature } from '@abacus/core/domain'
import { ChevronRightIcon } from 'lucide-react'
import { NATURE_LABEL } from '@/lib/nature'

/**
 * One mass of holdings and the lines under it: shares, funds, crypto, and what
 * no market quotes. The split between them is what an account is read for
 * first, so the header carries the mass's own total and the lines stay one
 * click away rather than a page away.
 *
 * Same fold as the rankings (#45): a native `<details>`, animated in
 * `globals.css`, so no client state holds it and it still works on a page whose
 * JS never arrives. Open by default, because the lines were already visible
 * before there were masses: folding is a gesture one asks for, not a toll.
 * Belonging is said by distance (`DESIGN.md` § Graphes): the lines sit tight
 * under their header, the next mass is pushed well off, and an indent plus a
 * hairline rail confirm it where a filled background would shout it.
 */
export function MassFold({
  nature,
  note,
  figures,
  children,
}: {
  nature: AssetNature
  /** Under the label: what the header cannot total, such as a missing price. */
  note?: string
  /** The mass's totals, in the same columns its lines use. */
  figures?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <details open className="fold group/mass">
      <summary className="flex cursor-pointer list-none items-center gap-3 py-2 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-0.5">
            <ChevronRightIcon className="size-3 shrink-0 text-faint transition-transform group-open/mass:rotate-90" />
            <span className="truncate text-[12.5px] font-semibold">{NATURE_LABEL[nature]}</span>
          </span>
          {note && <span className="truncate pl-3.5 text-[11px] text-faint">{note}</span>}
        </span>
        {figures}
      </summary>
      <div className="relative flex flex-col divide-y divide-border/70 pb-4 pl-3.5">
        {/* Drawn, not bordered: a border would shift the rows and their columns
            would no longer line up with the header's. */}
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-4 left-[5px] w-px rounded-full bg-input"
        />
        {children}
      </div>
    </details>
  )
}
