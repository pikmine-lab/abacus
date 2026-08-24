'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Toggle } from '@/components/ui/toggle'
import { eur, frDateLong } from '@/lib/utils'

/**
 * Amounts over time, the reference chart of DESIGN.md: 2px family lines,
 * hairline grid, crosshair snapping to the nearest day, one tooltip listing
 * every visible series, direct end labels on wide screens.
 *
 * Its window is the caller's, from the page's filter row or from a control on
 * its own section: this draws what it is handed. The toggles are the legend,
 * not a filter, and they refuse nothing: comparing more series is what the
 * view is for, so they only show once there are two. The palette holds six
 * measured hues and repeats past them, the end label carrying the identity
 * either way.
 */

interface Line {
  id: string
  name: string
}
interface Row {
  day: string
  lineId: string
  balance: number
}
/** The horizontal a series is read against: apports for a performance curve. */
interface Baseline {
  value: number
  name: string
}

/**
 * Series hues, in the order slots are handed out. Six is the measured maximum
 * on the card surface in all pairs (DESIGN.md § Couleur), and the chart opens
 * on as many lines as the palette holds.
 */
const SLOT_VARS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
]
/** End label type size, in px: the layout is measured against it. */
const LABEL_SIZE = 11
/** Gap between the plot edge and the label, plus breathing room on the right. */
const LABEL_PAD = 16
/** Vertical room one end label needs. */
const LABEL_GAP = 15
/** Plot height and the vertical margins the label column shares with it. */
const H = 250
const M_T = 12
const M_B = 24

/**
 * Lines the chart opens on: the highest at the end of the window, not the
 * first alphabetically. Rows are dense (one per line per day), so the last day
 * carries each line's closing value.
 */
function bestFunded(lines: Line[], rows: Row[], count: number): Line[] {
  const last = new Map<string, Row>()
  for (const r of rows) {
    const seen = last.get(r.lineId)
    if (!seen || r.day > seen.day) last.set(r.lineId, r)
  }
  return [...lines]
    .sort((a, b) => (last.get(b.id)?.balance ?? 0) - (last.get(a.id)?.balance ?? 0))
    .slice(0, count)
}

/** Which hue each opening line gets. */
function openingSlots(lines: Line[], rows: Row[]): Map<string, number> {
  return new Map(bestFunded(lines, rows, SLOT_VARS.length).map((a, i) => [a.id, i]))
}

/** Trims the name, never the amount: a cut number would be a wrong number. */
function fitLabel(name: string, amount: string, room: number, measure: (s: string) => number): string {
  const full = `${name} · ${amount}`
  if (measure(full) <= room) return full
  let cut = name
  while (cut.length > 1 && measure(`${cut}… · ${amount}`) > room) cut = cut.slice(0, -1)
  return `${cut}… · ${amount}`
}

function frDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

function frMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  const label = new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('fr-FR', { month: 'short' })
  return label.replace('.', '')
}

/**
 * The gap between two gridlines: a round number (1, 2 or 5 × a power of ten)
 * of the right size for four or five of them. A fixed 500 € step was written
 * for account balances and says nothing anywhere else: a share at 709 € got
 * two lines, a performance of +312 € got one.
 */
function niceStep(range: number): number {
  const raw = range / 4
  if (!(raw > 0)) return 1
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 5]) if (raw <= m * magnitude) return m * magnitude
  return 10 * magnitude
}

/**
 * A tick, in French. Thousands read as `13,5k`, which is the whole point of
 * the form; below that the number is written out, because "0,7k" for a share
 * at 709 € is a worse answer than the price itself.
 */
function tickLabel(value: number, step: number): string {
  // Math.ceil hands back -0 for a floor just under zero, and that formats as "-0".
  const v = value === 0 ? 0 : value
  if (step >= 100 && Math.abs(v) >= 1000) return `${(v / 1000).toFixed(v % 1000 ? 1 : 0).replace('.', ',')}k`
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2
  return v.toLocaleString('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function BalanceChart({
  lines,
  rows,
  today,
  baseline,
  zeroBased = true,
  ariaLabel = 'Évolution des soldes par compte',
}: {
  lines: Line[]
  rows: Row[]
  /** Boundary between what happened and what is merely extrapolated. */
  today: string
  /** Drawn and named, and the area fills from it rather than from the floor. */
  baseline?: Baseline
  /**
   * Whether zero belongs in the frame. It does for a balance, a valuation or a
   * performance, which are all read against it; it does not for a price, where
   * forcing it flattens the variation into a straight line.
   */
  zeroBased?: boolean
  ariaLabel?: string
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const inkRef = useRef<CanvasRenderingContext2D | null>(null)
  const [width, setWidth] = useState(0)
  const [slots, setSlots] = useState<Map<string, number>>(() => openingSlots(lines, rows))
  const [hover, setHover] = useState<number | null>(null)

  // Which lines are shown is state, so it survives a rescoping of the same
  // chart (the toggles are not lost when the window changes). But when the
  // caller hands over a different *set* of lines, that state designates series
  // that no longer exist and every one of them is filtered out: the chart goes
  // blank until it is remounted, which is why a reload used to "fix" it.
  // Reset during render rather than in an effect, so nothing is ever painted
  // empty.
  const identity = lines.map((l) => l.id).join('|')
  const [known, setKnown] = useState(identity)
  if (known !== identity) {
    setKnown(identity)
    setSlots(openingSlots(lines, rows))
  }

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    // Labels are laid out against their real width, in the font they render
    // in: the fixed right margin they used to sit in is what cropped them.
    const ctx = document.createElement('canvas').getContext('2d')
    if (ctx) {
      ctx.font = `${LABEL_SIZE}px ${getComputedStyle(el).fontFamily}`
      inkRef.current = ctx
    }
    const measure = () => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const days = useMemo(() => [...new Set(rows.map((r) => r.day))].sort(), [rows])

  // Beyond today the series only carries the last known balance forward: it is
  // a projection, and it says so rather than passing for measured history.
  const lastPast = useMemo(() => {
    const index = days.findIndex((d) => d > today)
    return index === -1 ? days.length - 1 : Math.max(0, index - 1)
  }, [days, today])

  const byAccount = useMemo(() => {
    const map = new Map<string, Map<string, number>>()
    for (const r of rows) {
      if (!map.has(r.lineId)) map.set(r.lineId, new Map())
      map.get(r.lineId)!.set(r.day, r.balance)
    }
    return map
  }, [rows])

  function toggle(id: string) {
    setSlots((prev) => {
      const next = new Map(prev)
      if (next.has(id)) {
        if (next.size === 1) return prev
        next.delete(id)
      } else {
        // Nothing is refused: the least-used hue is taken, which is a free one
        // until the palette is full and a repeat after that.
        const counts = SLOT_VARS.map((_, s) => [...next.values()].filter((v) => v === s).length)
        next.set(id, counts.indexOf(Math.min(...counts)))
      }
      return next
    })
  }

  if (days.length < 2)
    return (
      <p className="py-6 text-[13px] text-faint">Pas encore assez d’historique pour tracer une courbe.</p>
    )

  const hasFuture = lastPast < days.length - 1
  const narrow = width < 520
  const series = lines
    .filter((a) => slots.has(a.id))
    .map((a) => ({
      ...a,
      slot: slots.get(a.id)!,
      values: days.map((d) => byAccount.get(a.id)?.get(d) ?? 0),
    }))
  // Only the first series holding the reference hue lays an area, or a
  // repeated hue would stack two washes on top of each other.
  const areaId = series.find((s) => s.slot === 0)?.id

  const allValues = series.flatMap((s) => s.values)
  // What has to stay in frame besides the data: zero when the series is read
  // against it, and the baseline when there is one, since a reference nobody
  // can see is not one.
  const anchors = [...(zeroBased ? [0] : []), ...(baseline ? [baseline.value] : [])]
  const min = Math.min(...allValues, ...anchors)
  const max = Math.max(...allValues, ...anchors)
  const pad = (max - min) * 0.1 || Math.abs(max) * 0.1 || 50
  // A baseline keeps room under it: pinned to the frame it merges with the
  // axis, and a performance that never left zero would then be drawn on the
  // border itself, which reads as nothing drawn at all.
  const y0 = zeroBased && min >= 0 && !baseline ? min : min - pad
  const y1 = max + pad
  const areaFloor = baseline?.value ?? y0

  const tickStep = niceStep(y1 - y0)
  const yTicks: number[] = []
  // Walked by index, not by adding the step: a step of 0,01 accumulates its
  // own rounding error and lands the labels off the round numbers.
  for (let i = Math.ceil(y0 / tickStep); i * tickStep <= y1; i++) yTicks.push(i * tickStep)
  // Amounts to the precision the scale itself resolves. Whole euros read a
  // balance fine and turn a token at 0,42 € into "0 €".
  const amount = (v: number) => eur(v, tickStep < 10 ? 2 : 0)

  const textWidth = (s: string) => inkRef.current?.measureText(s).width ?? s.length * LABEL_SIZE * 0.56
  // More labels than the height holds are dropped rather than stacked: the
  // legend and the tooltip still name every series.
  const labelsFit = series.length * LABEL_GAP <= H - M_T - M_B - 6
  const labels =
    narrow || !labelsFit
      ? []
      : series.map((s) => ({ id: s.id, name: s.name, v: s.values[s.values.length - 1] ?? 0 }))
  // The right margin IS the label column, so it is cut to the labels instead of
  // fixed: measured, capped at a third of the frame, and what still does not
  // fit is trimmed by us below rather than by the frame.
  const wanted = Math.max(0, ...labels.map((l) => textWidth(`${l.name} · ${amount(l.v)}`))) + LABEL_PAD
  // Rounded up, not to the nearest: rounding down half a pixel takes that
  // half out of `room` below and trims a name that fitted.
  const M = { t: M_T, r: narrow ? 14 : Math.ceil(Math.min(wanted, width * 0.34)), b: M_B, l: 46 }
  const X = (i: number) => M.l + (i / Math.max(1, days.length - 1)) * (width - M.l - M.r)
  const Y = (v: number) => M.t + (1 - (v - y0) / (y1 - y0)) * (H - M.t - M.b)

  // Day labels on short windows, month labels beyond: the tick has to stay
  // readable, and repeating "août" eight times says nothing.
  const byDay = days.length <= 45
  const xTicks: { i: number; label: string }[] = []
  let previous = ''
  const every = Math.max(1, Math.round(days.length / (narrow ? 4 : 8)))
  for (let i = 0; i < days.length; i += every) {
    const label = byDay ? frDay(days[i]!) : frMonth(days[i]!)
    if (label === previous) continue
    previous = label
    xTicks.push({ i, label })
  }

  // Direct end labels, pushed apart when they collide (never stacked). With
  // six series colliding is the rule, so the stack is then pulled back inside
  // the frame from both edges: pushing down alone walked off the bottom.
  const room = M.r - LABEL_PAD
  const ends = labels
    .map((l) => ({ ...l, text: fitLabel(l.name, amount(l.v), room, textWidth), y: Y(l.v) }))
    .sort((a, b) => a.y - b.y)
  for (let i = 1; i < ends.length; i++) {
    if (ends[i]!.y - ends[i - 1]!.y < LABEL_GAP) ends[i]!.y = ends[i - 1]!.y + LABEL_GAP
  }
  for (let i = ends.length - 1; i >= 0; i--) {
    const floor = i === ends.length - 1 ? H - M.b - 2 : ends[i + 1]!.y - LABEL_GAP
    if (ends[i]!.y > floor) ends[i]!.y = floor
  }
  for (let i = 0; i < ends.length; i++) {
    const ceiling = i === 0 ? M.t + 4 : ends[i - 1]!.y + LABEL_GAP
    if (ends[i]!.y < ceiling) ends[i]!.y = ceiling
  }

  function onMove(e: React.PointerEvent) {
    const rect = wrapRef.current!.getBoundingClientRect()
    const px = e.clientX - rect.left
    const idx = Math.round(((px - M.l) / Math.max(1, X(days.length - 1) - M.l)) * (days.length - 1))
    setHover(Math.max(0, Math.min(days.length - 1, idx)))
  }

  const tooltipLeft = hover === null ? 0 : Math.min(Math.max(X(hover) + 14, 0), Math.max(0, width - 200))

  return (
    <div className="flex flex-col gap-2">
      {/* A legend of one is noise: it names what the section title already
          says, and its toggle refuses to turn off. */}
      {lines.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {lines.map((a) => {
            const on = slots.has(a.id)
            return (
              <Toggle
                key={a.id}
                size="sm"
                pressed={on}
                onPressedChange={() => toggle(a.id)}
                className="h-7 gap-1.5 px-2 text-xs font-normal text-faint data-[state=on]:text-muted-foreground"
              >
                <span
                  className="h-0.5 w-3.5 rounded-full"
                  style={{ background: on ? SLOT_VARS[slots.get(a.id)!] : 'var(--faint)' }}
                />
                {a.name}
              </Toggle>
            )
          })}
        </div>
      )}

      <div
        ref={wrapRef}
        className="relative touch-pan-y"
        style={{ minHeight: H }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* Nothing is drawn before the container has been measured: a guessed
            width pushes the marks out of frame instead of scaling them. */}
        {width > 0 && (
          <svg width="100%" height={H} role="img" aria-label={ariaLabel}>
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={M.l} x2={width - M.r} y1={Y(v)} y2={Y(v)} stroke="var(--grid)" />
                <text
                  x={M.l - 7}
                  y={Y(v) + 3.5}
                  textAnchor="end"
                  className="font-mono"
                  fontSize={10.5}
                  fill="var(--faint)"
                >
                  {tickLabel(v, tickStep)}
                </text>
              </g>
            ))}
            <line x1={M.l} x2={width - M.r} y1={Y(y0)} y2={Y(y0)} stroke="var(--border)" />
            {baseline && (
              <g>
                {/* Solid, and heavier than the grid: dashes are taken, they mean
                    "extrapolated" everywhere else on this chart. */}
                <line
                  x1={M.l}
                  x2={width - M.r}
                  y1={Y(baseline.value)}
                  y2={Y(baseline.value)}
                  stroke="var(--muted-foreground)"
                />
                <text x={M.l + 5} y={Y(baseline.value) - 5} fontSize={10} fill="var(--muted-foreground)">
                  {baseline.name}
                </text>
              </g>
            )}
            {hasFuture && (
              <g>
                {/* The flag marks where measured history stops. One word, no essay. */}
                <line
                  x1={X(lastPast)}
                  x2={X(lastPast)}
                  y1={M.t}
                  y2={H - M.b}
                  stroke="var(--faint)"
                  strokeDasharray="2 3"
                />
                <rect
                  x={X(lastPast) + 1}
                  y={M.t}
                  width={62}
                  height={14}
                  rx={3}
                  fill="var(--secondary)"
                  stroke="var(--border)"
                />
                <text x={X(lastPast) + 6} y={M.t + 10} fontSize={9.5} fill="var(--muted-foreground)">
                  projection
                </text>
              </g>
            )}
            {xTicks.map((t) => (
              <text
                key={t.i}
                x={X(t.i)}
                y={H - 6}
                textAnchor="middle"
                className="font-mono"
                fontSize={10.5}
                fill="var(--faint)"
              >
                {t.label}
              </text>
            ))}
            {series.map((s) => {
              const point = (v: number, i: number) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`
              // Measured history is solid; past today the line only carries the
              // last known balance forward, so it is drawn as what it is.
              const past = s.values
                .slice(0, lastPast + 1)
                .map((v, i) => point(v, i))
                .join(' ')
              const future = hasFuture
                ? s.values
                    .slice(lastPast)
                    .map((v, i) => point(v, i + lastPast))
                    .join(' ')
                : ''
              const last = s.values[s.values.length - 1] ?? 0
              return (
                <g key={s.id}>
                  {s.id === areaId && (
                    <polygon
                      // From the baseline when there is one: the wash is then
                      // what the curve gained or lost against it, which is the
                      // whole reading. From the floor otherwise, as before.
                      points={`${M.l},${Y(areaFloor)} ${past} ${X(lastPast)},${Y(areaFloor)}`}
                      fill={SLOT_VARS[0]}
                      opacity={0.08}
                    />
                  )}
                  <polyline
                    points={past}
                    fill="none"
                    stroke={SLOT_VARS[s.slot]}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {future && (
                    <polyline
                      points={future}
                      fill="none"
                      stroke={SLOT_VARS[s.slot]}
                      strokeWidth={2}
                      strokeDasharray="3 4"
                      strokeLinecap="round"
                      opacity={0.75}
                    />
                  )}
                  <circle
                    cx={X(days.length - 1)}
                    cy={Y(last)}
                    r={4}
                    fill={hasFuture ? 'var(--background)' : SLOT_VARS[s.slot]}
                    stroke={SLOT_VARS[s.slot]}
                    strokeWidth={2}
                  />
                </g>
              )
            })}
            {ends.map((e) => (
              <text
                key={e.id}
                x={width - M.r + 10}
                y={e.y + 4}
                fontSize={LABEL_SIZE}
                fill="var(--muted-foreground)"
              >
                {e.text}
              </text>
            ))}
            {hover !== null && (
              <g>
                <line x1={X(hover)} x2={X(hover)} y1={M.t} y2={H - M.b} stroke="var(--faint)" />
                {series.map((s) => (
                  <circle
                    key={s.id}
                    cx={X(hover)}
                    cy={Y(s.values[hover] ?? 0)}
                    r={4.5}
                    fill={SLOT_VARS[s.slot]}
                    stroke="var(--background)"
                    strokeWidth={2}
                  />
                ))}
              </g>
            )}
          </svg>
        )}

        {hover !== null && days[hover] && (
          <div
            className="pointer-events-none absolute top-3 z-10 min-w-44 rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg"
            style={{ left: tooltipLeft }}
          >
            <p className="text-[11px] text-faint">{frDateLong(days[hover])}</p>
            {series.map((s) => (
              <p key={s.id} className="flex items-center gap-2 py-px text-xs">
                <span className="h-0.5 w-3 rounded-full" style={{ background: SLOT_VARS[s.slot] }} />
                <span className="text-muted-foreground">{s.name}</span>
                <span className="ml-auto pl-3 font-mono font-semibold tabular">
                  {amount(s.values[hover] ?? 0)}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
