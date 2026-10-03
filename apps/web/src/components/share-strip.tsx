'use client'

import { useRouter } from 'next/navigation'
import { type PointerEvent, useEffect, useRef, useState } from 'react'
import {
  BreakdownBars,
  type BreakdownDimension,
  type BreakdownItem,
  type Mark,
  share,
  UNSET_LABEL,
} from '@/components/breakdown-bars'
import { type Period, periodParams } from '@/lib/period'
import { cn, eur } from '@/lib/utils'

/*
 * The whole period in one bar: each line takes the length of its share, so
 * what weighs half of the spending is seen to be half before any number is
 * read. Five lines and a rest, like the donut: past that a slice is too thin
 * to name. Every slice is copper and told from its neighbour by a 2px gap,
 * the rest stays neutral; names sit under the slices wide enough to hold them,
 * and the list underneath carries every line with its share.
 *
 * The list and the strip are one reading: a row pointed at in the list lights
 * its slice, and a category of an unfolded group lights its own part inside
 * the group's slice, where it sits among the group's categories.
 */

const SHOWN = 5
/** Under this width a slice carries no name under it: the list names it. */
const LABEL_MIN = 84

interface Slice {
  id: string
  label: string
  item?: BreakdownItem
  amount: number
  rest?: boolean
}

interface Hovered {
  slice: Slice
  x: number
  y: number
}

/** The strip and its list, sharing what is pointed at. */
export function ShareRanking({
  rows,
  dimension,
  period,
  from,
  emptyLabel,
}: {
  rows: BreakdownItem[]
  dimension: BreakdownDimension
  period: Period
  from: string
  emptyLabel: string
}) {
  const [mark, setMark] = useState<Mark | null>(null)
  return (
    <>
      <ShareStrip rows={rows} dimension={dimension} period={period} from={from} mark={mark} />
      <BreakdownBars
        rows={rows}
        dimension={dimension}
        from={from}
        period={period}
        size="share"
        emptyLabel={emptyLabel}
        onMark={setMark}
      />
    </>
  )
}

function ShareStrip({
  rows,
  dimension,
  period,
  from,
  mark,
}: {
  rows: BreakdownItem[]
  dimension: BreakdownDimension
  period: Period
  from: string
  mark: Mark | null
}) {
  const router = useRouter()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hovered, setHovered] = useState<Hovered | null>(null)

  const sorted = [...rows].filter((r) => r.net > 0).sort((a, b) => b.net - a.net)
  const total = sorted.reduce((sum, r) => sum + r.net, 0)
  const drawn = total > 0

  // Re-run when the strip appears: a period with nothing to draw renders no
  // wrapper, and the component stays mounted across a period change.
  useEffect(() => {
    const el = wrapRef.current
    if (!drawn || !el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [drawn])

  if (!drawn) return null
  const head = sorted.length > SHOWN + 1 ? sorted.slice(0, SHOWN) : sorted
  const tail = sorted.slice(head.length)
  const slices: Slice[] = head.map((r) => ({
    id: r.key ?? 'none',
    label: r.label ?? UNSET_LABEL[dimension],
    item: r,
    amount: r.net,
  }))
  if (tail.length > 0)
    slices.push({
      id: 'rest',
      label: `${tail.length} autres`,
      amount: tail.reduce((sum, r) => sum + r.net, 0),
      rest: true,
    })

  // What is lit: the slice under the pointer, else the one the list points
  // at, which is the rest when its row was merged into it. A row with nothing
  // left to draw (fully refunded) has no slice and lights nothing.
  const marked = !mark
    ? null
    : slices.some((s) => s.id === mark.row)
      ? mark.row
      : tail.some((r) => (r.key ?? 'none') === mark.row)
        ? 'rest'
        : null
  const lit = hovered?.slice.id ?? marked
  const part = !hovered && mark?.part && marked === mark.row ? partOf(slices, mark) : null

  const room = width - (slices.length - 1) * 2
  const hrefOf = (s: Slice) =>
    s.item?.key && dimension !== 'categoryGroup'
      ? `/movements?${dimension}=${s.item.key}&${periodParams(period)}&from=${from}`
      : null
  const track = (slice: Slice) => (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    setHovered({ slice, x: e.clientX, y: e.clientY })
  }

  return (
    <div ref={wrapRef} className="flex flex-col gap-2 pb-4" onPointerLeave={() => setHovered(null)}>
      <div className="flex h-11 gap-[2px]">
        {slices.map((s) => {
          const href = hrefOf(s)
          const on = lit === s.id
          // A slice lit for one of its parts dims like its neighbours, so the
          // part drawn over it is what the eye finds.
          const quiet = lit !== null && (!on || part !== null)
          const style = {
            flexGrow: s.amount,
            flexBasis: 0,
            background: s.rest ? 'var(--faint)' : 'var(--chart-1)',
            opacity: quiet ? 0.3 : s.rest ? 0.5 : 1,
          }
          const inner =
            on && part ? (
              <span
                aria-hidden
                className="absolute inset-y-0 rounded-[2px] bg-[var(--chart-1)]"
                style={{ left: `${part.from}%`, width: `${part.width}%` }}
              />
            ) : null
          const label = `${s.label}, ${eur(s.amount)}, ${share(s.amount, total)}`
          const box = 'relative min-w-[3px] overflow-hidden rounded-[3px] transition-[opacity] duration-150'
          return (
            // The slice carries the dim, its lit part sits beside it at full
            // ink: an opacity on the slice would dim the part with it.
            <div
              key={s.id}
              className="relative flex min-w-[3px]"
              style={{ flexGrow: s.amount, flexBasis: 0 }}
            >
              {href ? (
                <button
                  type="button"
                  aria-label={label}
                  onClick={() => router.push(href)}
                  onPointerMove={track(s)}
                  className={cn(
                    box,
                    'w-full cursor-pointer focus-visible:outline-2 focus-visible:outline-ring',
                  )}
                  style={{ background: style.background, opacity: style.opacity }}
                />
              ) : (
                <div
                  role="img"
                  aria-label={label}
                  onPointerMove={track(s)}
                  className={cn(box, 'w-full')}
                  style={{ background: style.background, opacity: style.opacity }}
                />
              )}
              {inner}
            </div>
          )
        })}
      </div>
      {/* A row of names only when it names more than one share: alone, the
          first name repeats the list's first row just below it. */}
      {width > 0 && slices.filter((s) => (s.amount / total) * room >= LABEL_MIN).length > 1 && (
        <div className="flex gap-[2px]" aria-hidden>
          {slices.map((s) => {
            const px = (s.amount / total) * room
            const quiet = lit !== null && lit !== s.id
            return (
              <div
                key={s.id}
                className="min-w-[3px] transition-opacity duration-150"
                style={{ flexGrow: s.amount, flexBasis: 0, opacity: quiet ? 0.45 : 1 }}
              >
                {px >= LABEL_MIN && (
                  <div className="flex flex-col pr-2">
                    <span
                      className={cn(
                        'truncate text-[13.5px]',
                        s.rest ? 'text-muted-foreground' : 'text-foreground',
                      )}
                    >
                      {s.label}
                    </span>
                    <span className="font-mono text-[12.5px] text-muted-foreground tabular">
                      {share(s.amount, total)}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {hovered && <HoverCard {...hovered} total={total} />}
    </div>
  )
}

/**
 * Where a category sits inside its group's slice, in percents of the slice:
 * after the categories listed before it, as long as its own amount. Same
 * order as the list, so the lit part is where the row is.
 */
function partOf(slices: Slice[], mark: Mark): { from: number; width: number } | null {
  const group = slices.find((s) => s.id === mark.row)?.item
  if (!group?.categories || group.net <= 0) return null
  let before = 0
  for (const category of group.categories) {
    if ((category.key ?? 'none') === mark.part)
      return {
        from: (Math.max(0, before) / group.net) * 100,
        width: (Math.max(0, category.net) / group.net) * 100,
      }
    before += category.net
  }
  return null
}

const CARD_WIDTH = 208
const CARD_HEIGHT = 96

function HoverCard({ slice, x, y, total }: Hovered & { total: number }) {
  const flipX = typeof window !== 'undefined' && x + CARD_WIDTH + 20 > window.innerWidth
  const flipY = typeof window !== 'undefined' && y + CARD_HEIGHT + 24 > window.innerHeight
  return (
    <div
      className="pointer-events-none fixed z-50 w-52 rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg"
      style={{ left: flipX ? x - CARD_WIDTH - 14 : x + 14, top: flipY ? y - CARD_HEIGHT - 10 : y + 16 }}
      role="tooltip"
    >
      <p className="truncate text-[11px] text-faint">{slice.label}</p>
      <p className="flex items-baseline gap-2 py-px text-xs">
        <span className="text-muted-foreground">{share(slice.amount, total)}</span>
        <span className="ml-auto pl-3 font-mono font-semibold tabular">{eur(slice.amount)}</span>
      </p>
      {slice.item && (
        <p className="mt-1 border-t border-border pt-1 text-[10.5px] text-faint">
          {slice.item.count} mouvement{slice.item.count > 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
