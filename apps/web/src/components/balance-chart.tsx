'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Toggle } from '@/components/ui/toggle'
import { eur, frDateLong } from '@/lib/utils'

/**
 * Account balances over time — the reference chart of DESIGN.md: 2px family
 * lines, hairline grid, crosshair snapping to the nearest day, one tooltip
 * listing every visible series, direct end labels on wide screens.
 *
 * It has no period control of its own: the page's filter row scopes it, like
 * everything else below that row. The account toggles are the legend, not a
 * filter — three series at once is the validated ceiling of the palette.
 */

interface Account {
  id: string
  name: string
}
interface Row {
  day: string
  accountId: string
  balance: number
}

const SLOT_VARS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)']
const MAX_ACTIVE = 3

function frDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

function frMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  const label = new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('fr-FR', { month: 'short' })
  return label.replace('.', '')
}

export function BalanceChart({
  accounts,
  rows,
  today,
}: {
  accounts: Account[]
  rows: Row[]
  /** Boundary between what happened and what is merely extrapolated. */
  today: string
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [slots, setSlots] = useState<Map<string, number>>(
    () => new Map(accounts.slice(0, MAX_ACTIVE).map((a, i) => [a.id, i])),
  )
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
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
      if (!map.has(r.accountId)) map.set(r.accountId, new Map())
      map.get(r.accountId)!.set(r.day, r.balance)
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
        if (next.size >= MAX_ACTIVE) return prev
        const used = new Set(next.values())
        next.set(id, [0, 1, 2].find((s) => !used.has(s))!)
      }
      return next
    })
  }

  if (days.length < 2)
    return (
      <p className="py-6 text-[13px] text-faint">Pas encore assez d’historique pour tracer une courbe.</p>
    )

  const hasFuture = lastPast < days.length - 1
  const H = 250
  const narrow = width < 520
  const M = { t: 12, r: narrow ? 14 : 150, b: 24, l: 46 }
  const active = accounts.filter((a) => slots.has(a.id))
  const series = active.map((a) => ({
    ...a,
    slot: slots.get(a.id)!,
    values: days.map((d) => byAccount.get(a.id)?.get(d) ?? 0),
  }))

  const allValues = series.flatMap((s) => s.values)
  const min = Math.min(...allValues, 0)
  const max = Math.max(...allValues, 1)
  const pad = (max - min) * 0.1 || 50
  const y0 = min - (min < 0 ? pad : 0)
  const y1 = max + pad
  const X = (i: number) => M.l + (i / Math.max(1, days.length - 1)) * (width - M.l - M.r)
  const Y = (v: number) => M.t + (1 - (v - y0) / (y1 - y0)) * (H - M.t - M.b)

  const tickStep = Math.max(500, Math.ceil((y1 - y0) / 4 / 500) * 500)
  const yTicks: number[] = []
  for (let v = Math.ceil(y0 / tickStep) * tickStep; v <= y1; v += tickStep) yTicks.push(v)

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

  // Direct end labels, pushed apart when they collide (never stacked).
  const ends = series
    .map((s) => ({ slot: s.slot, name: s.name, v: s.values[s.values.length - 1] ?? 0 }))
    .map((e) => ({ ...e, y: Y(e.v) }))
    .sort((a, b) => a.y - b.y)
  for (let i = 1; i < ends.length; i++) {
    if (ends[i]!.y - ends[i - 1]!.y < 15) ends[i]!.y = ends[i - 1]!.y + 15
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
      <div className="flex flex-wrap gap-1">
        {accounts.map((a) => {
          const on = slots.has(a.id)
          return (
            <Toggle
              key={a.id}
              size="sm"
              pressed={on}
              onPressedChange={() => toggle(a.id)}
              title={
                !on && slots.size >= MAX_ACTIVE ? '3 séries maximum : désactive un compte d’abord' : undefined
              }
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
          <svg width="100%" height={H} role="img" aria-label="Évolution des soldes par compte">
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
                  {`${(v / 1000).toFixed(v % 1000 ? 1 : 0).replace('.', ',')}k`}
                </text>
              </g>
            ))}
            <line x1={M.l} x2={width - M.r} y1={Y(y0)} y2={Y(y0)} stroke="var(--border)" />
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
                  {s.slot === 0 && (
                    <polygon
                      points={`${M.l},${Y(y0)} ${past} ${X(lastPast)},${Y(y0)}`}
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
            {!narrow &&
              ends.map((e) => (
                <text
                  key={e.slot}
                  x={width - M.r + 10}
                  y={e.y + 4}
                  fontSize={11}
                  fill="var(--muted-foreground)"
                >
                  {e.name} · {eur(e.v)}
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
                  {eur(s.values[hover] ?? 0)}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
