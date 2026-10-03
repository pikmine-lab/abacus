'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { eur } from '@/lib/utils'

/**
 * Income against spending, month by month, mirrored around zero. Direction is
 * carried by the side of the axis a bar sits on, never by color alone, so the
 * two hues only have to be told apart, not decoded.
 *
 * Each spending bar shows both readings at once, as DESIGN.md requires: the
 * solid part is net, the translucent part above it is what came back as a
 * linked refund. Solid + translucent = gross.
 *
 * Clicking a month scopes the whole page to it: the chart is a way into the
 * detail, not a picture of it. Only the period changes: what else the page is
 * framed on (a direction, a dimension) stays, so the click compares months
 * rather than starting over.
 */

export interface MonthFlow {
  month: string
  income: number
  expenseGross: number
  expenseNet: number
}

/** Width of the "en cours" flag over the running month. */
const FLAG_WIDTH = 54

function monthLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')
}

function monthLabelLong(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

export function FlowChart({
  rows,
  currentMonth,
  selectedMonth,
  legend = 'top',
  height = 220,
}: {
  rows: MonthFlow[]
  /** "YYYY-MM" of the running month: its bars are a partial count, not a total. */
  currentMonth?: string
  /** "YYYY-MM" of the month the page is scoped to, washed so the eye finds it. */
  selectedMonth?: string
  /**
   * `axis` names the two sides of the zero line ("entré", "sorti") instead of a
   * legend: the position already says which is which, the words confirm it.
   */
  legend?: 'top' | 'axis'
  height?: number
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
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

  if (rows.length === 0)
    return <p className="py-6 text-[13px] text-faint">Rien à comparer sur cette période.</p>

  const H = height
  // The running month is still being filled: it is drawn hatched behind a flag
  // rather than side by side with finished months as if it were comparable.
  const partialIndex = currentMonth ? rows.findIndex((r) => r.month.slice(0, 7) === currentMonth) : -1
  const side = { b: 22, l: 46 }
  // The flag sits in the running month's slot when it fits there. On a narrow
  // frame it would cover the month before, often the washed one, so it moves
  // above the plot with its left edge on the dashed line: the top margin makes
  // room for it, and the right margin grows just enough for it to end inside
  // the frame instead of being pushed back over that month.
  const flagAbove = partialIndex >= 0 && (width - side.l - 8) / rows.length < FLAG_WIDTH + 2
  const right =
    flagAbove && partialIndex > 0
      ? Math.max(
          8,
          Math.ceil(width - side.l - ((width - side.l - FLAG_WIDTH - 2) * rows.length) / partialIndex),
        )
      : 8
  const M = { t: flagAbove ? 24 : 10, r: right, ...side }
  const step = (width - M.l - M.r) / rows.length
  const peak = Math.max(...rows.map((r) => Math.max(r.income, r.expenseGross)), 1)
  const barWidth = Math.min(24, Math.max(6, step * 0.42))
  const mid = M.t + (H - M.t - M.b) / 2
  const scale = (H - M.t - M.b) / 2 / peak
  const centerOf = (i: number) => M.l + step * (i + 0.5)

  const tickStep = Math.max(500, Math.ceil(peak / 2 / 500) * 500)
  // A short band has no room for amounts beside « entré » and « sorti »: the
  // grid lines stay, the amounts are read in the tooltip.
  const tickLabels = H >= 180
  const ticks: number[] = []
  for (let v = tickStep; v <= peak; v += tickStep) ticks.push(v)

  const everyLabel = Math.max(1, Math.ceil(rows.length / (width < 520 ? 6 : 12)))
  const scopeTo = (ref: string) => {
    const params = new URLSearchParams(searchParams)
    params.set('period', 'month')
    params.set('ref', ref)
    router.push(`?${params}`, { scroll: false })
  }
  const tooltipLeft =
    hover === null ? 0 : Math.min(Math.max(centerOf(hover) - 90, 0), Math.max(0, width - 190))

  return (
    <div className="flex flex-col gap-2">
      {legend === 'top' && (
        <div className="flex items-center gap-4 text-[11.5px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: 'var(--good)' }} />
            Revenus
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: 'var(--chart-1)' }} />
            Dépenses (net)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: 'var(--chart-1)', opacity: 0.32 }} />
            Remboursé
          </span>
        </div>
      )}

      <div ref={wrapRef} className="relative" style={{ minHeight: H }} onPointerLeave={() => setHover(null)}>
        {/* Nothing is drawn before the container has been measured: a guessed
            width pushes the marks out of frame instead of scaling them. */}
        {width > 0 && (
          <svg width="100%" height={H} role="img" aria-label="Revenus et dépenses par mois">
            <defs>
              {/* Hatch, not a lighter tint: an unfinished month must not read as a small one. */}
              <pattern
                id="flow-partial-good"
                width="5"
                height="5"
                patternTransform="rotate(45)"
                patternUnits="userSpaceOnUse"
              >
                <rect width="5" height="5" fill="var(--good)" opacity="0.28" />
                <line x1="0" y1="0" x2="0" y2="5" stroke="var(--good)" strokeWidth="2.4" />
              </pattern>
              <pattern
                id="flow-partial-spend"
                width="5"
                height="5"
                patternTransform="rotate(45)"
                patternUnits="userSpaceOnUse"
              >
                <rect width="5" height="5" fill="var(--chart-1)" opacity="0.28" />
                <line x1="0" y1="0" x2="0" y2="5" stroke="var(--chart-1)" strokeWidth="2.4" />
              </pattern>
            </defs>
            {/* The page's own month, washed under everything: the grid, the zero line
                and the flag of the running month stay readable on top of it. */}
            {rows.map((r, i) =>
              r.month.slice(0, 7) === selectedMonth ? (
                <rect
                  key="selected"
                  x={centerOf(i) - step / 2 + 2}
                  y={M.t}
                  width={step - 4}
                  height={H - M.t - M.b}
                  rx={6}
                  fill="var(--secondary)"
                />
              ) : null,
            )}
            {ticks.map((v) => (
              <g key={v}>
                <line
                  x1={M.l}
                  x2={width - M.r}
                  y1={mid - v * scale}
                  y2={mid - v * scale}
                  stroke="var(--grid)"
                />
                <line
                  x1={M.l}
                  x2={width - M.r}
                  y1={mid + v * scale}
                  y2={mid + v * scale}
                  stroke="var(--grid)"
                />
                {tickLabels && (
                  <>
                    <text
                      x={M.l - 7}
                      y={mid - v * scale + 3.5}
                      textAnchor="end"
                      className="font-mono"
                      fontSize={10.5}
                      fill="var(--faint)"
                    >
                      {`${(v / 1000).toFixed(v % 1000 ? 1 : 0).replace('.', ',')}k`}
                    </text>
                    <text
                      x={M.l - 7}
                      y={mid + v * scale + 3.5}
                      textAnchor="end"
                      className="font-mono"
                      fontSize={10.5}
                      fill="var(--faint)"
                    >
                      {`${(v / 1000).toFixed(v % 1000 ? 1 : 0).replace('.', ',')}k`}
                    </text>
                  </>
                )}
              </g>
            ))}
            {/* Without a legend the zero line is what names the two sides, so it
                stays readable across the washed month. */}
            <line
              x1={M.l}
              x2={width - M.r}
              y1={mid}
              y2={mid}
              stroke={legend === 'axis' ? 'var(--input)' : 'var(--border)'}
            />
            {legend === 'axis' && (
              <g fontSize={10.5} fill="var(--faint)" textAnchor="end">
                <text x={M.l - 7} y={mid - 5}>
                  entré
                </text>
                <text x={M.l - 7} y={mid + 13}>
                  sorti
                </text>
              </g>
            )}
            {partialIndex >= 0 && (
              <g>
                <line
                  x1={centerOf(partialIndex) - step / 2}
                  x2={centerOf(partialIndex) - step / 2}
                  y1={flagAbove ? 18 : M.t}
                  y2={H - M.b}
                  stroke="var(--faint)"
                  strokeDasharray="2 3"
                />
                <rect
                  x={
                    flagAbove
                      ? centerOf(partialIndex) - step / 2
                      : Math.min(centerOf(partialIndex) - step / 2 + 1, width - M.r - FLAG_WIDTH - 2)
                  }
                  y={flagAbove ? 4 : M.t}
                  width={FLAG_WIDTH}
                  height={14}
                  rx={3}
                  fill="var(--secondary)"
                  stroke="var(--border)"
                />
                <text
                  x={
                    flagAbove
                      ? centerOf(partialIndex) - step / 2 + 5
                      : Math.min(centerOf(partialIndex) - step / 2 + 6, width - M.r - FLAG_WIDTH + 3)
                  }
                  y={(flagAbove ? 4 : M.t) + 10}
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
              const netH = r.expenseNet * scale
              const refundH = Math.max(0, (r.expenseGross - r.expenseNet) * scale)
              const incomeH = r.income * scale
              const on = hover === i
              const ref = r.month.slice(0, 7)
              const selected = ref === selectedMonth
              return (
                // Each month is a real control: reachable by Tab, activated by
                // Enter or Space, and named for a screen reader. A <button> is not
                // valid inside <svg>, so the role carries it.
                // biome-ignore lint/a11y/useSemanticElements: see above, no HTML button can live inside an SVG group.
                <g
                  key={r.month}
                  role="button"
                  tabIndex={0}
                  aria-label={`${monthLabelLong(r.month)} : ${eur(r.income)} de revenus, ${eur(r.expenseNet)} de dépenses`}
                  onPointerEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onClick={() => scopeTo(ref)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    e.preventDefault()
                    scopeTo(ref)
                  }}
                  className="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {/* Full-height hit area: the bars themselves are too thin to aim at. */}
                  <rect x={cx - step / 2} y={M.t} width={step} height={H - M.t - M.b} fill="transparent" />
                  {on && (
                    <rect
                      x={cx - step / 2}
                      y={M.t}
                      width={step}
                      height={H - M.t - M.b}
                      fill="var(--secondary)"
                      opacity={0.5}
                    />
                  )}
                  {r.income > 0 && (
                    <rect
                      x={x}
                      y={mid - incomeH}
                      width={barWidth}
                      height={incomeH}
                      rx={3}
                      fill="var(--good)"
                      opacity={hover === null || on ? 1 : 0.5}
                    />
                  )}
                  {r.expenseNet > 0 && (
                    <rect
                      x={x}
                      y={mid}
                      width={barWidth}
                      height={netH}
                      rx={3}
                      fill="var(--chart-1)"
                      opacity={hover === null || on ? 1 : 0.5}
                    />
                  )}
                  {refundH > 1 && (
                    <rect
                      // 2px gap so the two readings stay two marks, not one blur.
                      x={x}
                      y={mid + netH + 2}
                      width={barWidth}
                      height={Math.max(1, refundH - 2)}
                      rx={3}
                      fill="var(--chart-1)"
                      opacity={hover === null || on ? 0.32 : 0.18}
                    />
                  )}
                  {i % everyLabel === 0 && (
                    <text
                      x={cx}
                      y={H - 6}
                      textAnchor="middle"
                      className="font-mono"
                      fontSize={10.5}
                      fill={selected ? 'var(--foreground)' : on ? 'var(--muted-foreground)' : 'var(--faint)'}
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
            className="pointer-events-none absolute top-1 z-10 min-w-44 rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg"
            style={{ left: tooltipLeft }}
          >
            <p className="text-[11px] text-faint">{monthLabelLong(rows[hover].month)}</p>
            <p className="flex items-center gap-2 py-px text-xs">
              <span className="size-2 rounded-sm" style={{ background: 'var(--good)' }} />
              <span className="text-muted-foreground">{legend === 'axis' ? 'Entré' : 'Revenus'}</span>
              <span className="ml-auto pl-3 font-mono font-semibold tabular">{eur(rows[hover].income)}</span>
            </p>
            <p className="flex items-center gap-2 py-px text-xs">
              <span className="size-2 rounded-sm" style={{ background: 'var(--chart-1)' }} />
              <span className="text-muted-foreground">{legend === 'axis' ? 'Sorti' : 'Dépenses'}</span>
              <span className="ml-auto pl-3 font-mono font-semibold tabular">
                {eur(rows[hover].expenseNet)}
              </span>
            </p>
            {rows[hover].expenseGross !== rows[hover].expenseNet &&
              (legend === 'axis' ? (
                // Without a legend, the pale part of the bar is named here, where it is pointed at.
                <p className="flex items-center gap-2 py-px text-xs">
                  <span
                    className="size-2 rounded-sm"
                    style={{ background: 'var(--chart-1)', opacity: 0.32 }}
                  />
                  <span className="text-muted-foreground">Remboursé</span>
                  <span className="ml-auto pl-3 font-mono font-semibold tabular">
                    {eur(rows[hover].expenseGross - rows[hover].expenseNet)}
                  </span>
                </p>
              ) : (
                <p className="text-[11px] text-faint">brut {eur(rows[hover].expenseGross)}</p>
              ))}
            <p className="mt-1 flex items-center gap-2 border-t border-border pt-1 text-xs">
              <span className="text-muted-foreground">Épargné</span>
              <span className="ml-auto pl-3 font-mono font-semibold tabular">
                {eur(rows[hover].income - rows[hover].expenseNet)}
              </span>
            </p>
            {rows[hover].month.slice(0, 7) === currentMonth && (
              <p className="text-[10.5px] text-faint">mois en cours, encore incomplet</p>
            )}
            <p className="mt-1 text-[10.5px] text-faint">Clic : cadrer la page sur ce mois</p>
          </div>
        )}
      </div>
    </div>
  )
}
