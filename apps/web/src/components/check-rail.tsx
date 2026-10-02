'use client'

import { useState } from 'react'
import type { CheckEntry } from '@/components/balance-check-history'
import { cn, daysBetween, eur, frDate, freshness } from '@/lib/utils'

/** How far back a rail reads, in days: twice the age past which a check is stale. */
const RAIL_DAYS = 90

/**
 * When an account was last pointed, drawn rather than written. Every rail of
 * the page shares one scale, the last ninety days ending today, so the rails
 * line up from row to row and the stale ones read at a glance: their last
 * check sits left of the threshold mark. A check is a dot, the latest one full
 * and ringed with the page ground. While its gap is open it turns into a red
 * diamond: the shape says it as much as the colour, since the words for it
 * live in the "À pointer" card, not under the row. An account never pointed
 * keeps an empty rail, and the card names it too.
 *
 * The exact date is in the tooltip, which follows a mouse and anchors under
 * the rail on focus or a tap: a keyboard or a finger reads it as well.
 */
export function CheckRail({
  name,
  checks,
  today,
  staleDays,
}: {
  name: string
  /** Newest first, as the history lists them. */
  checks: CheckEntry[]
  today: string
  staleDays: number
}) {
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const latest = checks[0]
  const age = latest ? daysBetween(latest.checkedOn, today) : null
  const open = latest && !latest.settled ? latest.gap : 0
  const stale = age !== null && age > staleDays
  const inWindow = checks.filter((c) => daysBetween(c.checkedOn, today) <= RAIL_DAYS)
  // Past the window, the latest check pins to the left edge, hollow: older than
  // anything the rail measures, which the tooltip dates exactly.
  const position = (days: number) => `${Math.max(0, 1 - days / RAIL_DAYS) * 100}%`
  const anchorOn = (el: HTMLElement) => {
    const box = el.getBoundingClientRect()
    setAnchor({ x: box.left, y: box.bottom - 8 })
  }

  const summary = !latest
    ? 'jamais pointé'
    : `pointé le ${frDate(latest.checkedOn)}, ${
        open !== 0 ? `écart de ${eur(Math.abs(open), 2)} non soldé` : 'aucun écart ouvert'
      }`
  const shown = cursor ?? anchor

  return (
    <button
      type="button"
      aria-label={`${name} : ${summary}`}
      className="relative block h-4 w-full cursor-default rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onPointerMove={(e) => e.pointerType === 'mouse' && setCursor({ x: e.clientX, y: e.clientY })}
      onPointerLeave={() => setCursor(null)}
      onFocus={(e) => anchorOn(e.currentTarget)}
      onClick={(e) => anchorOn(e.currentTarget)}
      onBlur={() => setAnchor(null)}
    >
      <span aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-input" />
      <span
        aria-hidden
        className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-faint"
        style={{ left: position(staleDays) }}
      />
      {inWindow.slice(1).map((check) => (
        <span
          key={check.id}
          aria-hidden
          className="absolute top-1/2 size-1 -translate-1/2 rounded-full bg-muted-foreground"
          style={{ left: position(daysBetween(check.checkedOn, today)) }}
        />
      ))}
      {latest && age !== null && (
        <span
          aria-hidden
          className={cn(
            'absolute top-1/2 size-2 -translate-1/2 ring-2 ring-background',
            open !== 0
              ? 'rotate-45 rounded-[1px] bg-destructive'
              : age > RAIL_DAYS
                ? 'rounded-full border border-muted-foreground bg-background'
                : stale
                  ? 'rounded-full bg-muted-foreground'
                  : 'rounded-full bg-foreground',
          )}
          style={{ left: position(age) }}
        />
      )}
      {shown && (
        <RailTooltip
          x={shown.x}
          y={shown.y}
          name={name}
          latest={latest}
          today={today}
          open={open}
          count={inWindow.length}
        />
      )}
    </button>
  )
}

/** The rail's scale, set once in the header of each list, over the column of rails. */
export function CheckRailAxis({ staleDays }: { staleDays: number }) {
  return (
    <div aria-hidden className="relative h-3 font-mono text-[10px] leading-none text-faint">
      <span className="absolute left-0">{RAIL_DAYS} j</span>
      <span className="absolute -translate-x-1/2" style={{ left: `${(1 - staleDays / RAIL_DAYS) * 100}%` }}>
        {staleDays} j
      </span>
      {/* Under the name, the rail is half as wide: the word would run into the mark. */}
      <span className="absolute right-0">
        <span className="@xl:hidden">auj.</span>
        <span className="hidden @xl:inline">aujourd’hui</span>
      </span>
    </div>
  )
}

const CARD_WIDTH = 232
const CARD_HEIGHT = 80

/** Same ink as the chart tooltips; it flips at the viewport edge and never sits under the cursor. */
function RailTooltip({
  x,
  y,
  name,
  latest,
  today,
  open,
  count,
}: {
  x: number
  y: number
  name: string
  latest: CheckEntry | undefined
  today: string
  open: number
  count: number
}) {
  const flipX = x + CARD_WIDTH + 20 > window.innerWidth
  const flipY = y + CARD_HEIGHT + 24 > window.innerHeight
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 w-[232px] rounded-lg border border-border bg-popover px-3 py-2 text-left text-popover-foreground shadow-lg"
      style={{ left: flipX ? x - CARD_WIDTH - 14 : x + 14, top: flipY ? y - CARD_HEIGHT - 10 : y + 16 }}
    >
      <p className="truncate text-[11px] text-faint">{name}</p>
      {latest ? (
        <>
          <p className="py-px text-xs">
            Pointé le {frDate(latest.checkedOn)}
            {/* Wraps whole, dot first, rather than leave the dot or half a phrase behind. */}{' '}
            <span className="whitespace-nowrap text-faint">· {freshness(latest.checkedOn, today)}</span>
          </p>
          <p className={cn('py-px text-xs', open !== 0 ? 'text-destructive' : 'text-muted-foreground')}>
            {open !== 0
              ? `écart de ${eur(Math.abs(open), 2)}, non soldé`
              : latest.gap !== 0
                ? 'écart soldé'
                : 'aucun écart'}
          </p>
          <p className="mt-1 border-t border-border pt-1 text-[10.5px] text-faint">
            {count} pointage{count > 1 ? 's' : ''} en {RAIL_DAYS} jours
          </p>
        </>
      ) : (
        <p className="py-px text-xs">Jamais pointé</p>
      )}
    </div>
  )
}
