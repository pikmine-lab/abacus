'use client'

import { ChevronRightIcon } from 'lucide-react'
import Link from 'next/link'
import { type PointerEvent, useState } from 'react'
import { eur } from '@/lib/utils'

/**
 * Ranked magnitudes: one bar per category, actor, activity or category group.
 * Identity is carried by the label and magnitude by the length, so every bar
 * wears the same copper: a hue per row would encode nothing and DESIGN.md's
 * "color follows the entity" cannot hold when the entity has no stored color.
 *
 * The figure a row shows is the net, which is also what the ranking is ordered
 * by: that is what the period cost, and ranking by gross would put a line
 * above another it ends up below once the refund is back. The gross keeps its
 * own reading in the translucent end of the bar, and the hover card spells it
 * out along with what a bar cannot say, the number of movements.
 *
 * A group is the exception: it is a label written on categories, not an entity
 * movements can be filtered by, so its row unfolds into the categories it
 * merges instead of linking, and those categories carry the link. The fold is
 * a native `<details>`, animated in `globals.css`: no client state for it, and
 * it still works on a page whose JS never arrives.
 */

export interface BreakdownItem {
  key: string | null
  label: string | null
  gross: number
  net: number
  count: number
  /** What the row merges, when it merges anything: a group holds categories. */
  categories?: BreakdownItem[]
}

/** The dimension a bar chart ranks. Only a group has no entity of its own. */
export type BreakdownDimension = 'category' | 'actor' | 'activity' | 'categoryGroup'

/** What an unset dimension is called, in the words of that dimension. */
export const UNSET_LABEL: Record<BreakdownDimension, string> = {
  category: 'Sans catégorie',
  actor: 'Sans acteur',
  activity: 'Hors activité',
  categoryGroup: 'Sans groupe',
}

/**
 * Every row is one line tall, the second line under an amount having made a
 * refunded row taller than its neighbours and broken the vertical rhythm the
 * ranking is read by.
 *
 * An unfolded category is drawn thinner and tighter than the group above it:
 * the mass keeps the full stroke, what composes it reads as one block under
 * it. Same origin and same scale, so the lengths stay comparable.
 */
const row = (indent?: boolean) =>
  `group grid grid-cols-[92px_1fr_78px] items-center gap-2 sm:grid-cols-[132px_1fr_90px] sm:gap-3 ${
    indent ? 'py-0.5' : 'py-1.5'
  }`

/** A row being hovered, and where the pointer is while it is. */
interface Hovered {
  item: BreakdownItem
  label: string
  x: number
  y: number
}

export function BreakdownBars({
  rows,
  /** The dimension ranked here; a group unfolds, the others link. */
  dimension,
  from,
  emptyLabel = 'Rien sur cette période.',
  max: maxRows,
}: {
  rows: BreakdownItem[]
  dimension: BreakdownDimension
  /** Origin key, so the movements page can offer the way back. */
  from: string
  emptyLabel?: string
  max?: number
}) {
  const [hovered, setHovered] = useState<Hovered | null>(null)

  if (rows.length === 0) return <p className="py-3 text-[13px] text-faint">{emptyLabel}</p>

  const shown = maxRows ? rows.slice(0, maxRows) : rows
  // One scale for the whole section, unfolded rows included: a length means an
  // amount here, so a category cannot be measured against its own group while
  // its neighbour is measured against the biggest one. The scale is the gross,
  // which is the longest a bar ever gets.
  const peak = Math.max(...shown.map((r) => r.gross), 1)

  // The card follows the pointer rather than sitting under the row: a bar
  // spans the width of the page, so anchoring it to the row would put the
  // reading far from the eye. A finger gets nothing: it would land under the
  // hand, and the tap is a navigation anyway.
  const track = (item: BreakdownItem, label: string) => (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    setHovered({ item, label, x: e.clientX, y: e.clientY })
  }
  const release = () => setHovered(null)

  return (
    <div className="flex flex-col">
      {shown.map((item) => {
        const label = item.label ?? UNSET_LABEL[dimension]
        return item.categories ? (
          // What says "these belong to that" is distance, not a box: the
          // categories sit tight under their group (4px apart) and the next
          // group is pushed a good way off (16px), so proximity does the
          // grouping the way the Gestalt law has it. Indentation and a hairline
          // rail confirm it; a filled background was the heavy way to say the
          // same thing.
          //
          // The bleed lives on the fold itself, so nothing inside needs a
          // negative margin: the animated `::details-content` clips whatever
          // sticks out of it.
          <details key={item.key ?? 'none'} className="fold group/mass -mx-2 px-2">
            <summary
              className={`${row()} cursor-pointer list-none rounded-md hover:bg-secondary/40 [&::-webkit-details-marker]:hidden`}
              onPointerMove={track(item, label)}
              onPointerLeave={release}
            >
              <Cells row={item} label={label} peak={peak} chevron />
            </summary>
            <div className="relative pb-4">
              {/* Drawn, not bordered: a border would shift the grid and the
                  category bars would no longer start where the group's does. */}
              <span
                aria-hidden
                className="pointer-events-none absolute top-0 bottom-4 left-[5px] w-px rounded-full bg-input"
              />
              {item.categories.map((child) => (
                <Cells
                  key={child.key ?? 'none'}
                  row={child}
                  label={child.label ?? UNSET_LABEL.category}
                  dimension="category"
                  peak={peak}
                  from={from}
                  indent
                  onHover={track}
                  onLeave={release}
                />
              ))}
            </div>
          </details>
        ) : (
          <Cells
            key={item.key ?? 'none'}
            row={item}
            label={label}
            dimension={dimension}
            peak={peak}
            from={from}
            onHover={track}
            onLeave={release}
          />
        )
      })}
      {maxRows && rows.length > maxRows && (
        <p className="pt-2 text-[11.5px] text-faint">
          + {rows.length - maxRows} autre{rows.length - maxRows > 1 ? 's' : ''} sous Analyse
        </p>
      )}
      {hovered && <HoverCard {...hovered} />}
    </div>
  )
}

/** Room the card needs before it has to flip to the other side of the cursor. */
const CARD_WIDTH = 208
const CARD_HEIGHT = 96

/**
 * What the row cannot hold: how many movements make it, what it merges, and
 * the gross reading when a refund pulled it apart from the net. Same ink as
 * the chart tooltips, and it never sits under the cursor, which would make it
 * flicker as the pointer chases it.
 */
function HoverCard({ item, label, x, y }: Hovered) {
  const refund = Math.round((item.gross - item.net) * 100) / 100
  const flipX = typeof window !== 'undefined' && x + CARD_WIDTH + 20 > window.innerWidth
  const flipY = typeof window !== 'undefined' && y + CARD_HEIGHT + 24 > window.innerHeight
  return (
    <div
      className="pointer-events-none fixed z-50 w-52 rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg"
      style={{
        left: flipX ? x - CARD_WIDTH - 14 : x + 14,
        top: flipY ? y - CARD_HEIGHT - 10 : y + 16,
      }}
      role="tooltip"
    >
      <p className="truncate text-[11px] text-faint">{label}</p>
      <p className="flex items-baseline gap-2 py-px text-xs">
        <span className="text-muted-foreground">{refund > 0 ? 'Net' : 'Dépensé'}</span>
        <span className="ml-auto pl-3 font-mono font-semibold tabular">{eur(item.net)}</span>
      </p>
      {refund > 0 && (
        <>
          <p className="flex items-baseline gap-2 py-px text-xs">
            <span className="text-muted-foreground">Brut</span>
            <span className="ml-auto pl-3 font-mono tabular">{eur(item.gross)}</span>
          </p>
          <p className="flex items-baseline gap-2 py-px text-[11px] text-faint">
            <span>Remboursé</span>
            <span className="ml-auto pl-3 font-mono tabular">{eur(refund)}</span>
          </p>
        </>
      )}
      <p className="mt-1 border-t border-border pt-1 text-[10.5px] text-faint">
        {item.count} mouvement{item.count > 1 ? 's' : ''}
        {item.categories
          ? ` · ${item.categories.length} catégorie${item.categories.length > 1 ? 's' : ''}`
          : ''}
      </p>
    </div>
  )
}

/**
 * One bar: label, magnitude, amount. Wrapped in a link when the row has an
 * entity to filter movements by, in a plain row otherwise. Inside a `<summary>`
 * it is neither, the fold being the interaction.
 */
function Cells({
  row: item,
  label,
  dimension,
  peak,
  from,
  chevron,
  indent,
  onHover,
  onLeave,
}: {
  row: BreakdownItem
  label: string
  dimension?: BreakdownDimension
  peak: number
  from?: string
  chevron?: boolean
  /** An unfolded row: only its label steps in, so the bars keep one origin. */
  indent?: boolean
  onHover?: (item: BreakdownItem, label: string) => (e: PointerEvent) => void
  onLeave?: () => void
}) {
  const netPart = (item.net / peak) * 100
  const refundPart = ((item.gross - item.net) / peak) * 100
  const inner = (
    <>
      <span className={`flex min-w-0 items-center gap-0.5 ${indent ? 'pl-3.5 sm:pl-4.5' : ''}`}>
        {chevron && (
          <ChevronRightIcon className="size-3 shrink-0 text-faint transition-transform group-open/mass:rotate-90" />
        )}
        <span className="truncate text-[12.5px] text-muted-foreground group-hover:text-foreground">
          {label}
        </span>
      </span>
      <span className={`flex items-center gap-[2px] ${indent ? 'h-3' : 'h-4'}`}>
        <span
          className={`min-w-0.5 rounded-sm ${indent ? 'h-1.5' : 'h-3'}`}
          style={{ width: `${netPart}%`, background: 'var(--chart-1)' }}
        />
        {refundPart > 0.5 && (
          <span
            className={`rounded-sm ${indent ? 'h-1.5' : 'h-3'}`}
            style={{ width: `${refundPart}%`, background: 'var(--chart-1)', opacity: 0.32 }}
          />
        )}
      </span>
      <span className="text-right font-mono text-[12.5px] font-semibold tabular">{eur(item.net)}</span>
    </>
  )

  if (chevron) return inner
  // A row of the ranking carries its own bleed; a row inside a fold does not,
  // the fold having it already and clipping anything that sticks out.
  const layout = `${row(indent)} ${indent ? '' : '-mx-2 px-2'}`
  const hover = { onPointerMove: onHover?.(item, label), onPointerLeave: onLeave }
  return item.key && from && dimension ? (
    <Link
      href={`/movements?${dimension}=${item.key}&from=${from}`}
      className={`${layout} rounded-md hover:bg-secondary/40`}
      {...hover}
    >
      {inner}
    </Link>
  ) : (
    <div className={layout} {...hover}>
      {inner}
    </div>
  )
}
