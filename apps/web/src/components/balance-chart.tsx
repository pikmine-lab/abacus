'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toggle } from '@/components/ui/toggle'
import { eur } from '@/lib/utils'

/**
 * Account balances over time — the reference chart of DESIGN.md: 2px family
 * lines, hairline grid, crosshair snapping to the nearest day, one tooltip
 * listing every visible series, direct end labels on wide screens.
 * At most three series at once (the family separates by luminance).
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

const RANGES = [
  { days: 30, label: '30 j' },
  { days: 90, label: '90 j' },
  { days: 182, label: '6 m' },
  { days: 365, label: '12 m' },
]
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

export function BalanceChart({ accounts, rows }: { accounts: Account[]; rows: Row[] }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  const [rangeDays, setRangeDays] = useState(90)
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

  const days = useMemo(() => {
    const all = [...new Set(rows.map((r) => r.day))].sort()
    return all.slice(Math.max(0, all.length - rangeDays))
  }, [rows, rangeDays])

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

  const H = 260
  const narrow = width < 520
  const M = { t: 12, r: narrow ? 14 : 150, b: 24, l: 44 }
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

  const xTicks: { i: number; label: string }[] = []
  let prevMonth = ''
  const every = Math.max(1, Math.round(days.length / (narrow ? 4 : 8)))
  for (let i = 0; i < days.length; i += every) {
    const label = rangeDays <= 30 ? frDay(days[i]!) : frMonth(days[i]!)
    if (label === prevMonth) continue
    prevMonth = label
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

  const tooltipLeft = hover === null ? 0 : Math.min(Math.max(X(hover) + 14, 0), Math.max(0, width - 190))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Soldes des comptes</CardTitle>
        <CardDescription>point quotidien · calculé depuis les mouvements déclarés</CardDescription>
        <CardAction>
          <Tabs value={String(rangeDays)} onValueChange={(v) => setRangeDays(Number(v))}>
            <TabsList className="h-8">
              {RANGES.map((r) => (
                <TabsTrigger key={r.days} value={String(r.days)} className="text-xs">
                  {r.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </CardAction>
      </CardHeader>

      <CardContent>
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
                  !on && slots.size >= MAX_ACTIVE
                    ? '3 séries maximum : désactive un compte d’abord'
                    : undefined
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
          className="relative mt-2 touch-pan-y"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
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
              const pts = s.values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')
              const last = s.values[s.values.length - 1] ?? 0
              return (
                <g key={s.id}>
                  {s.slot === 0 && (
                    <polygon
                      points={`${M.l},${Y(y0)} ${pts} ${X(days.length - 1)},${Y(y0)}`}
                      fill={SLOT_VARS[0]}
                      opacity={0.07}
                    />
                  )}
                  <polyline
                    points={pts}
                    fill="none"
                    stroke={SLOT_VARS[s.slot]}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  <circle
                    cx={X(days.length - 1)}
                    cy={Y(last)}
                    r={4}
                    fill={SLOT_VARS[s.slot]}
                    stroke="var(--card)"
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
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                ))}
              </g>
            )}
          </svg>

          {hover !== null && days[hover] && (
            <div
              className="pointer-events-none absolute top-3 z-10 min-w-42 rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg"
              style={{ left: tooltipLeft }}
            >
              <p className="text-[11px] text-faint">{frDay(days[hover])}</p>
              {series.map((s) => (
                <p key={s.id} className="flex items-center gap-2 py-px text-xs">
                  <span className="h-0.5 w-3 rounded-full" style={{ background: SLOT_VARS[s.slot] }} />
                  <span className="text-muted-foreground">{s.name}</span>
                  <span className="ml-auto pl-3 font-mono font-semibold tabular-nums">
                    {eur(s.values[hover] ?? 0)}
                  </span>
                </p>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
