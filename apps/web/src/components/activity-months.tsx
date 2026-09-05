'use client'

import { useEffect, useRef, useState } from 'react'
import { eur, frMonthLong } from '@/lib/utils'

/**
 * What one fiscal month of an activity came to: what came in under the
 * regime's basis, what it owes on it, and what is left. One bar per month,
 * read as DESIGN.md has it, full plus translucent: the solid part is the net,
 * the translucent part accolée is the charges and provisions that were taken
 * out of it, so the whole bar is what came in.
 *
 * The month being lived through is hatched behind its flag rather than drawn
 * smaller: unfinished is not small.
 */

export interface ActivityMonth {
  /** First day of the month, as the statement gives it. */
  month: string
  revenue: number
  /** Real charges plus the provisions of the rules: what the month owes. */
  charges: number
  net: number
  paidToSelf: number
  running: boolean
}

function monthLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')
}

/** A round grid step cut on the amplitude: 1, 2 or 5 times a power of ten. */
function niceStep(peak: number): number {
  const raw = Math.max(peak, 1) / 3
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  for (const factor of [1, 2, 5]) if (raw <= factor * magnitude) return factor * magnitude
  return 10 * magnitude
}

function tick(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 ? 1 : 0).replace('.', ',')}k`
  return String(value)
}

export function ActivityMonths({
  rows,
  /** How the regime names what came in: "encaissé", "facturé". */
  revenueWord,
}: {
  rows: ActivityMonth[]
  revenueWord: string
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
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

  if (rows.length === 0) return <p className="py-6 text-[13px] text-faint">Rien sur cet exercice.</p>

  const H = 200
  const M = { t: 12, r: 8, b: 22, l: 46 }
  // A month whose charges outrun what came in draws taller than its revenue,
  // which is exactly what happened: the scale says so rather than clipping it.
  const stack = (r: ActivityMonth) => Math.max(r.net, 0) + Math.max(r.charges, 0)
  const peak = Math.max(...rows.map((r) => Math.max(r.revenue, stack(r))), 1)
  const step = (width - M.l - M.r) / rows.length
  const barWidth = Math.min(24, Math.max(6, step * 0.46))
  const base = H - M.b
  const scale = (base - M.t) / peak
  const centerOf = (i: number) => M.l + step * (i + 0.5)

  const gridStep = niceStep(peak)
  const ticks: number[] = []
  for (let v = gridStep; v <= peak; v += gridStep) ticks.push(v)

  const runningIndex = rows.findIndex((r) => r.running)
  const everyLabel = Math.max(1, Math.ceil(rows.length / (width < 520 ? 6 : 12)))
  const tooltipLeft =
    hover === null ? 0 : Math.min(Math.max(centerOf(hover) - 90, 0), Math.max(0, width - 200))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-4 text-[11.5px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: 'var(--chart-1)' }} />
          Net
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: 'var(--chart-1)', opacity: 0.32 }} />
          Charges et provisions
        </span>
      </div>

      <div ref={wrapRef} className="relative" style={{ minHeight: H }} onPointerLeave={() => setHover(null)}>
        {/* Nothing is drawn before the container has been measured. */}
        {width > 0 && (
          <svg
            width="100%"
            height={H}
            role="img"
            aria-label="Par mois : ce qui est entré, les charges et provisions, le net"
          >
            <defs>
              <pattern
                id="activity-running"
                width="5"
                height="5"
                patternTransform="rotate(45)"
                patternUnits="userSpaceOnUse"
              >
                <rect width="5" height="5" fill="var(--chart-1)" opacity="0.28" />
                <line x1="0" y1="0" x2="0" y2="5" stroke="var(--chart-1)" strokeWidth="2.4" />
              </pattern>
            </defs>

            {ticks.map((v) => (
              <g key={v}>
                <line
                  x1={M.l}
                  x2={width - M.r}
                  y1={base - v * scale}
                  y2={base - v * scale}
                  stroke="var(--grid)"
                />
                <text
                  x={M.l - 7}
                  y={base - v * scale + 3.5}
                  textAnchor="end"
                  className="font-mono"
                  fontSize={10.5}
                  fill="var(--faint)"
                >
                  {tick(v)}
                </text>
              </g>
            ))}
            <line x1={M.l} x2={width - M.r} y1={base} y2={base} stroke="var(--border)" />

            {runningIndex >= 0 && (
              <g>
                <line
                  x1={centerOf(runningIndex) - step / 2}
                  x2={centerOf(runningIndex) - step / 2}
                  y1={M.t}
                  y2={base}
                  stroke="var(--faint)"
                  strokeDasharray="2 3"
                />
                <rect
                  x={Math.min(centerOf(runningIndex) - step / 2 + 1, width - M.r - 56)}
                  y={M.t}
                  width={54}
                  height={14}
                  rx={3}
                  fill="var(--secondary)"
                  stroke="var(--border)"
                />
                <text
                  x={Math.min(centerOf(runningIndex) - step / 2 + 6, width - M.r - 51)}
                  y={M.t + 10}
                  fontSize={9.5}
                  fill="var(--muted-foreground)"
                >
                  en cours
                </text>
              </g>
            )}

            {rows.map((r, i) => {
              const cx = centerOf(i)
              const x = cx - barWidth / 2
              const netH = Math.max(r.net, 0) * scale
              const chargesH = Math.max(r.charges, 0) * scale
              const on = hover === i
              const dim = hover !== null && !on
              return (
                // The chart is one picture (role="img" on the svg): the months
                // are read again as rows in the table below, which is where each
                // one carries its way into the movements.
                <g key={r.month} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                  <rect x={cx - step / 2} y={M.t} width={step} height={base - M.t} fill="transparent" />
                  {on && (
                    <rect
                      x={cx - step / 2}
                      y={M.t}
                      width={step}
                      height={base - M.t}
                      fill="var(--secondary)"
                      opacity={0.5}
                    />
                  )}
                  {netH > 0 && (
                    <rect
                      x={x}
                      y={base - netH}
                      width={barWidth}
                      height={netH}
                      rx={3}
                      fill={r.running ? 'url(#activity-running)' : 'var(--chart-1)'}
                      opacity={dim ? 0.5 : 1}
                    />
                  )}
                  {chargesH > 1 && (
                    <rect
                      // 2px of air, so the two readings stay two marks.
                      x={x}
                      y={base - netH - chargesH - 2}
                      width={barWidth}
                      height={Math.max(1, chargesH)}
                      rx={3}
                      fill="var(--chart-1)"
                      opacity={dim ? 0.18 : 0.32}
                    />
                  )}
                  {i % everyLabel === 0 && (
                    <text
                      x={cx}
                      y={H - 6}
                      textAnchor="middle"
                      className="font-mono"
                      fontSize={10.5}
                      fill={on ? 'var(--muted-foreground)' : 'var(--faint)'}
                    >
                      {monthLabel(r.month)}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        )}

        {hover !== null && rows[hover] && (
          <div
            className="pointer-events-none absolute top-1 z-10 min-w-48 rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg"
            style={{ left: tooltipLeft }}
          >
            <p className="text-[11px] text-faint">{frMonthLong(rows[hover].month)}</p>
            <Line label={revenueWord} value={rows[hover].revenue} />
            <Line label="Charges et provisions" value={rows[hover].charges} />
            <Line label="Net" value={rows[hover].net} strong />
            <Line label="Versé" value={rows[hover].paidToSelf} />
            {rows[hover].running && (
              <p className="text-[10.5px] text-faint">mois en cours, encore incomplet</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Line({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <p className="flex items-baseline gap-2 py-px text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`ml-auto pl-3 font-mono tabular ${strong ? 'font-semibold' : ''}`}>{eur(value)}</span>
    </p>
  )
}
