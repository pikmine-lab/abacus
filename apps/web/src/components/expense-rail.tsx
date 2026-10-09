'use client'

import { useEffect, useState } from 'react'
import { cn, daysBetween, frDate, freshness } from '@/lib/utils'

/** How far ahead a rail reads, in days: a month, so every monthly line has its dot on it. */
export const RAIL_DAYS = 30

/**
 * Where today sits, as a share of the rail. The strip on its left is the lane
 * of what reached its date and still waits to be confirmed: an occurrence a
 * month late and one a day late are the same work, so the lane has no scale.
 */
const TODAY_AT = 0.1

/** One occurrence the rail places, by its due date. */
export interface RailMark {
  dueOn: string
}

/**
 * When a recurring expense leaves its account, drawn rather than written. Every
 * rail of the page shares one scale, today to thirty days ahead, so the rails
 * line up from row to row and the eye reads down a column what leaves before
 * the month turns, marked by a tick, and what leaves after.
 *
 * An occurrence ahead is a dot, the next one full and ringed with the page
 * ground, the ones after it (a weekly rhythm) smaller. One that reached its
 * date and waits for its confirmation sits copper in the lane left of today:
 * the accent marks what waits on the user, and the "À confirmer" card above
 * is where it is done. A line whose next occurrence falls past the window (a
 * yearly one) pins a hollow dot to the right edge.
 *
 * The exact dates are in the tooltip, which follows a mouse and anchors under
 * the rail on focus or a tap: a keyboard or a finger reads it as well.
 */
export function ExpenseRail({
  name,
  marks,
  today,
}: {
  name: string
  /** Oldest first: the late ones, then what falls within the window, then at most one beyond it. */
  marks: RailMark[]
  today: string
}) {
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const late = marks.filter((m) => m.dueOn <= today)
  const ahead = marks.filter((m) => m.dueOn > today && daysBetween(today, m.dueOn) <= RAIL_DAYS)
  const beyond = marks.find((m) => daysBetween(today, m.dueOn) > RAIL_DAYS)
  const turn = monthTurn(today)
  // An anchored tooltip is placed once, at the rail's position on screen:
  // scrolling would leave it behind, so it closes instead.
  useEffect(() => {
    if (!anchor) return
    const close = () => setAnchor(null)
    window.addEventListener('scroll', close, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', close, { capture: true })
  }, [anchor])
  const anchorOn = (el: HTMLElement) => {
    const box = el.getBoundingClientRect()
    setAnchor({ x: box.left, y: box.bottom - 8 })
  }
  const next = ahead[0] ?? beyond
  const summary = [
    late.length > 0 && `${late.length} échéance${late.length > 1 ? 's' : ''} à confirmer`,
    next && `prochaine le ${frDate(next.dueOn)}`,
  ]
    .filter(Boolean)
    .join(', ')
  const shown = cursor ?? anchor

  return (
    <button
      type="button"
      aria-label={`${name} : ${summary}`}
      className="relative block h-4 w-full cursor-default rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onPointerMove={(e) => e.pointerType === 'mouse' && setCursor({ x: e.clientX, y: e.clientY })}
      onPointerLeave={() => setCursor(null)}
      // A mouse has the following tooltip: anchored on its click, it would
      // stay pinned once the cursor left. Keyboard focus and a tap anchor it.
      onFocus={(e) => e.currentTarget.matches(':focus-visible') && anchorOn(e.currentTarget)}
      onPointerUp={(e) => e.pointerType !== 'mouse' && anchorOn(e.currentTarget)}
      onBlur={() => setAnchor(null)}
    >
      {/* Drawn in SVG with crisp edges: a 1 px line at a fractional position,
          which a centred row often lands on, would be smoothed over two pixels
          and read lighter on one row than on the next. */}
      <svg aria-hidden className="absolute inset-0 size-full overflow-visible" shapeRendering="crispEdges">
        <line x1="0" x2="100%" y1="8" y2="8" stroke="var(--input)" />
        <line x1={position(0)} x2={position(0)} y1="3" y2="13" stroke="var(--faint)" />
        {turn !== null && (
          <line x1={position(turn)} x2={position(turn)} y1="4" y2="12" stroke="var(--input)" />
        )}
      </svg>
      {late.length > 0 && (
        <span
          aria-hidden
          className="absolute top-1/2 size-2 -translate-1/2 rounded-full bg-primary ring-2 ring-background"
          style={{ left: `${(TODAY_AT / 2) * 100}%` }}
        />
      )}
      {ahead.map((mark, i) => (
        <span
          key={mark.dueOn}
          aria-hidden
          className={cn(
            'absolute top-1/2 -translate-1/2 rounded-full',
            i === 0 ? 'size-2 bg-foreground ring-2 ring-background' : 'size-1 bg-muted-foreground',
          )}
          style={{ left: position(daysBetween(today, mark.dueOn)) }}
        />
      ))}
      {ahead.length === 0 && beyond && (
        <span
          aria-hidden
          className="absolute top-1/2 right-0 size-2 translate-x-1/2 -translate-y-1/2 rounded-full border border-muted-foreground bg-background"
        />
      )}
      {shown && <RailTooltip x={shown.x} y={shown.y} name={name} late={late} next={next} today={today} />}
    </button>
  )
}

/** The rail's scale, set once in the header of each list, over the column of rails. */
export function ExpenseRailAxis({ today }: { today: string }) {
  const turn = monthTurn(today)
  return (
    <div aria-hidden className="relative h-3 font-mono text-[10px] leading-none text-faint">
      <span className="absolute -translate-x-1/2" style={{ left: position(0) }}>
        auj.
      </span>
      {/* The month that starts there, rather than a count of days: what leaves
          before the tick is this month's, which is how a budget is read. Too
          close to the far edge, the tick stays and the far date names it. */}
      {turn !== null && turn <= 22 && (
        <span
          className={cn('absolute -translate-x-1/2', turn > 18 && 'hidden @4xl:inline')}
          style={{ left: position(turn) }}
        >
          {dayMonth(addDays(today, turn), false)}
        </span>
      )}
      <span className="absolute right-0">{dayMonth(addDays(today, RAIL_DAYS), true)}</span>
    </div>
  )
}

/** A day ahead of today, as a position on the rail. */
function position(days: number): string {
  return `${(TODAY_AT + ((1 - TODAY_AT) * Math.min(days, RAIL_DAYS)) / RAIL_DAYS) * 100}%`
}

/** Days from today to the first of next month, when it falls within the rail. */
function monthTurn(today: string): number | null {
  const [y, m] = today.split('-').map(Number)
  const first = new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 10)
  const days = daysBetween(today, first)
  return days <= RAIL_DAYS ? days : null
}

/** "nov." or "8 nov.": the year is never in doubt thirty days out. */
function dayMonth(iso: string, withDay: boolean): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString(
    'fr-FR',
    withDay ? { day: 'numeric', month: 'short' } : { month: 'short' },
  )
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10)
}

const CARD_WIDTH = 220
const CARD_HEIGHT = 64

/** Same ink as the chart tooltips; it flips at the viewport edge and never sits under the cursor. */
function RailTooltip({
  x,
  y,
  name,
  late,
  next,
  today,
}: {
  x: number
  y: number
  name: string
  late: RailMark[]
  next: RailMark | undefined
  today: string
}) {
  const flipX = x + CARD_WIDTH + 20 > window.innerWidth
  const flipY = y + CARD_HEIGHT + 24 > window.innerHeight
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 w-[220px] rounded-lg border border-border bg-popover px-3 py-2 text-left text-popover-foreground shadow-lg"
      style={{ left: flipX ? x - CARD_WIDTH - 14 : x + 14, top: flipY ? y - CARD_HEIGHT - 10 : y + 16 }}
    >
      <p className="truncate text-[11px] text-faint">{name}</p>
      {late.length > 0 && (
        <p className="py-px text-xs text-primary">
          {late.length > 1
            ? `${late.length} échéances à confirmer, depuis le ${frDate(late[0]!.dueOn)}`
            : `À confirmer, attendue le ${frDate(late[0]!.dueOn)}`}
        </p>
      )}
      {next && (
        <p className="py-px text-xs">
          Prochaine le {frDate(next.dueOn)}{' '}
          <span className="whitespace-nowrap text-faint">· {freshness(next.dueOn, today)}</span>
        </p>
      )}
    </div>
  )
}
