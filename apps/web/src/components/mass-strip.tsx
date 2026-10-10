'use client'

import { createContext, type PointerEvent, useContext, useEffect, useRef, useState } from 'react'
import { useShare } from '@/components/breakdown-bars'
import { useFormat } from '@/lib/format'
import { cn } from '@/lib/utils'

/*
 * The portfolio's split in one bar: each mass (funds, shares, coins, what no
 * market quotes) takes the length of what it is worth, so the half held in
 * funds is seen to be half before a number is read. Drawn like the ranking
 * strip of the analysis: copper parts 2px apart, 44px high since it carries
 * the list under it, names and shares under the parts wide enough for them.
 *
 * The strip and the list are one reading: a mass pointed at in the list
 * lights its part, and a part leads to its mass.
 */

/** Under this width a part carries no name under it: its mass in the list names it. */
const LABEL_MIN = 84

interface Focus {
  lit: string | null
  setLit: (id: string | null) => void
}

const FocusContext = createContext<Focus>({ lit: null, setLit: () => {} })

/** Holds what is pointed at, for the strip and the masses it sits above. */
export function MassFocus({ children }: { children: React.ReactNode }) {
  const [lit, setLit] = useState<string | null>(null)
  return <FocusContext.Provider value={{ lit, setLit }}>{children}</FocusContext.Provider>
}

/** One mass of the list, lighting its part of the strip while pointed at or focused within. */
export function MassLight({ id, children }: { id: string; children: React.ReactNode }) {
  const { setLit } = useContext(FocusContext)
  return (
    // Hover and focus only light the strip above; nothing is activated from here.
    // biome-ignore lint/a11y/noStaticElementInteractions: a highlight, not a control
    <div
      onPointerEnter={(e) => e.pointerType === 'mouse' && setLit(id)}
      onPointerLeave={() => setLit(null)}
      onFocus={() => setLit(id)}
      onBlur={() => setLit(null)}
    >
      {children}
    </div>
  )
}

export interface StripPart {
  id: string
  label: string
  amount: number
  /** Where the part leads: its mass in the list. */
  href: string
}

interface Hovered {
  part: StripPart
  x: number
  y: number
}

export function MassStrip({ parts, label }: { parts: StripPart[]; label: string }) {
  const format = useFormat()
  const share = useShare()
  const { lit: pointedInList } = useContext(FocusContext)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hovered, setHovered] = useState<Hovered | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const total = parts.reduce((sum, p) => sum + p.amount, 0)
  const lit = hovered?.part.id ?? pointedInList
  const room = width - (parts.length - 1) * 2
  const track = (part: StripPart) => (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    setHovered({ part, x: e.clientX, y: e.clientY })
  }

  return (
    <div ref={wrapRef} className="flex flex-col gap-2" onPointerLeave={() => setHovered(null)}>
      <div className="flex h-11 gap-[2px]">
        {parts.map((part) => (
          <a
            key={part.id}
            href={part.href}
            onPointerMove={track(part)}
            className="min-w-[3px] rounded-[3px] bg-[var(--chart-1)] transition-opacity duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            style={{
              flexGrow: part.amount,
              flexBasis: 0,
              opacity: lit !== null && lit !== part.id ? 0.3 : 1,
            }}
          >
            <span className="sr-only">
              {label}, {part.label}, {format.eur(part.amount)}, {share(part.amount, total)}
            </span>
          </a>
        ))}
      </div>
      {/* Names only when they name more than one part: alone, the first name
          would repeat the first mass just below it. */}
      {width > 0 && parts.filter((p) => (p.amount / total) * room >= LABEL_MIN).length > 1 && (
        <div className="flex gap-[2px]" aria-hidden>
          {parts.map((part) => (
            <div
              key={part.id}
              className="min-w-[3px] transition-opacity duration-150"
              style={{
                flexGrow: part.amount,
                flexBasis: 0,
                opacity: lit !== null && lit !== part.id ? 0.45 : 1,
              }}
            >
              {(part.amount / total) * room >= LABEL_MIN && (
                <div className="flex flex-col pr-2">
                  <span className="truncate text-[13.5px]">{part.label}</span>
                  <span className="font-mono text-[12.5px] text-muted-foreground tabular">
                    {share(part.amount, total)}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {hovered && <HoverCard {...hovered} total={total} />}
    </div>
  )
}

const CARD_WIDTH = 208
const CARD_HEIGHT = 64

function HoverCard({ part, x, y, total }: Hovered & { total: number }) {
  const format = useFormat()
  const share = useShare()
  const flipX = typeof window !== 'undefined' && x + CARD_WIDTH + 20 > window.innerWidth
  const flipY = typeof window !== 'undefined' && y + CARD_HEIGHT + 24 > window.innerHeight
  return (
    <div
      className={cn(
        'pointer-events-none fixed z-50 w-52 rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg',
      )}
      style={{ left: flipX ? x - CARD_WIDTH - 14 : x + 14, top: flipY ? y - CARD_HEIGHT - 10 : y + 16 }}
      role="tooltip"
    >
      <p className="truncate text-[11px] text-faint">{part.label}</p>
      <p className="flex items-baseline gap-2 py-px text-xs">
        <span className="text-muted-foreground">{share(part.amount, total)}</span>
        <span className="ml-auto pl-3 font-mono font-semibold tabular">{format.eur(part.amount)}</span>
      </p>
    </div>
  )
}
