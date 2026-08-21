'use client'

import { useState } from 'react'
import type { BreakdownItem } from '@/components/breakdown-bars'
import { eur } from '@/lib/utils'

/**
 * Spending by big mass: one arc per category group, ordered by weight, with
 * the legend carrying the identity. It answers "where does the money go, by
 * group" in a handful of arcs, where the category bars answer it line by line.
 *
 * The palette holds six measured hues (DESIGN.md § Couleur) and a group list
 * is routinely longer than that: the five biggest keep a hue of their own and
 * everything below folds into one arc, named in the legend. Repeating hues
 * would put two identical arcs side by side, which a circle cannot carry the
 * way a labelled line can.
 *
 * Hovering an arc or its legend row ties the two together: the others fade,
 * the row lights up, and the hole tells what the legend does not repeat, the
 * net reading and the number of movements. That link is what makes the hues
 * legible at all (DESIGN.md § Couleur, rule 4).
 *
 * An arc carries both readings the way the bars do: the solid part is net, the
 * translucent end is what came back as a linked refund. Scaling is done by the
 * viewBox, so nothing is drawn against a guessed width.
 */

/** Groups drawn under their own name; the rest folds into one arc. */
const NAMED = 5
const HUES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']
/**
 * The merged tail is a remainder, not an identity: it takes the faint ink
 * rather than a hue of its own. It also closes the circle against the first
 * arc, where a sixth hue would sit next to the copper it came from.
 */
const TAIL_HUE = 'var(--faint)'

/** Ring geometry, in the 100×100 viewBox the arcs are drawn in. */
const R = 40
const RING = 15
/** Breathing room between arcs, in percent of the circle. */
const GAP = 0.6
/** Below this share, an arc is thinner than the gap and reads as an artefact. */
const MIN_ARC = 0.6

interface Slice {
  label: string
  /** What the arc merges, when it merges anything. */
  detail?: string
  gross: number
  net: number
  count: number
  color: string
}

interface Arc {
  start: number
  length: number
  color: string
  /** A refund tail, drawn translucent against its own arc. */
  refund: boolean
}

export function SpendingDonut({
  rows,
  emptyLabel = 'Rien sur cette période.',
  /** What an unset group is called in this dimension. */
  noneLabel = 'Sans groupe',
}: {
  /** Ordered by gross, biggest first: the service already returns them so. */
  rows: BreakdownItem[]
  emptyLabel?: string
  noneLabel?: string
}) {
  const [hover, setHover] = useState<number | null>(null)

  const total = rows.reduce((sum, r) => sum + r.gross, 0)
  if (rows.length === 0 || total === 0) return <p className="py-3 text-[13px] text-faint">{emptyLabel}</p>

  const tail = rows.slice(NAMED)
  const slices: Slice[] = rows.slice(0, NAMED).map((row, i) => ({
    label: row.label ?? noneLabel,
    gross: row.gross,
    net: row.net,
    count: row.count,
    color: HUES[i]!,
  }))
  if (tail.length > 0)
    slices.push({
      label: `Autres (${tail.length})`,
      detail: tail.map((row) => row.label ?? noneLabel).join(', '),
      gross: tail.reduce((sum, r) => sum + r.gross, 0),
      net: tail.reduce((sum, r) => sum + r.net, 0),
      count: tail.reduce((sum, r) => sum + r.count, 0),
      color: TAIL_HUE,
    })

  // The gap is taken off the end of an arc, never off the share it stands for:
  // the next arc still starts where its own share starts.
  let cursor = 0
  const arcs: Arc[][] = slices.map((slice) => {
    const length = (slice.gross / total) * 100
    const net = (slice.net / total) * 100
    const gap = slices.length > 1 ? Math.min(GAP, length / 2) : 0
    const refund = length - net
    const drawn: Arc[] =
      refund > MIN_ARC
        ? [
            { start: cursor, length: net, color: slice.color, refund: false },
            { start: cursor + net, length: refund - gap, color: slice.color, refund: true },
          ]
        : [{ start: cursor, length: length - gap, color: slice.color, refund: false }]
    cursor += length
    return drawn
  })

  const on = hover !== null ? slices[hover] : null

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row" onPointerLeave={() => setHover(null)}>
      <div className="relative shrink-0">
        <svg
          viewBox="0 0 100 100"
          className="size-[132px] sm:size-[148px]"
          role="img"
          aria-label={`Dépenses par groupe : ${slices
            .map((s) => `${s.label} ${eur(s.gross)}`)
            .join(', ')}. Total ${eur(total)}.`}
        >
          {/* Arcs start at noon and run clockwise, biggest first. */}
          <g transform="rotate(-90 50 50)">
            {slices.map((slice, i) => (
              <g key={slice.label} onPointerEnter={() => setHover(i)}>
                {arcs[i]!.map((arc) => (
                  <circle
                    key={arc.start}
                    cx={50}
                    cy={50}
                    r={R}
                    pathLength={100}
                    fill="none"
                    stroke={arc.color}
                    strokeOpacity={
                      arc.refund
                        ? hover === null || hover === i
                          ? 0.32
                          : 0.14
                        : hover === null || hover === i
                          ? 1
                          : 0.35
                    }
                    strokeWidth={RING}
                    strokeDasharray={`${Math.max(arc.length, 0)} ${100 - Math.max(arc.length, 0)}`}
                    strokeDashoffset={-arc.start}
                  />
                ))}
              </g>
            ))}
          </g>
        </svg>
        {/* The hole is the tooltip: what the legend row next to it does not say. */}
        {on && (
          <div
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-6 text-center"
            aria-hidden
          >
            <span className="font-mono text-[13px] font-semibold tabular">{share(on.gross, total)} %</span>
            {on.net !== on.gross && (
              <span className="font-mono text-[10.5px] tabular text-faint">net {eur(on.net)}</span>
            )}
            <span className="text-[10px] text-faint">
              {on.count} mouvement{on.count > 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Capped, so an amount stays next to the label it belongs to rather
          than drifting to the far edge of a wide column. */}
      <ul className="flex w-full min-w-0 max-w-sm flex-col">
        {slices.map((slice, i) => (
          <li
            key={slice.label}
            onPointerEnter={() => setHover(i)}
            className={`-mx-2 flex items-baseline gap-2 rounded-md px-2 py-1 ${
              hover === i ? 'bg-secondary/40' : ''
            }`}
          >
            <span
              className="size-2 shrink-0 translate-y-[-1px] rounded-full transition-opacity"
              style={{ background: slice.color, opacity: hover === null || hover === i ? 1 : 0.35 }}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span
                className={`block truncate text-[12.5px] ${
                  hover === i ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {slice.label}
              </span>
              {slice.detail && (
                <span className="block truncate text-[10.5px] text-faint">{slice.detail}</span>
              )}
            </span>
            <span className="shrink-0 text-right font-mono text-[12.5px] font-semibold tabular">
              {eur(slice.gross)}
            </span>
            <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular text-faint">
              {share(slice.gross, total)} %
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function share(part: number, total: number): number {
  return Math.round((part / total) * 100)
}
