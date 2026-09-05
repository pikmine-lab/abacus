import Link from 'next/link'
import { eur } from '@/lib/utils'

/**
 * Ranked magnitudes of an activity: revenue by client, charges by category.
 * Identity is in the label and magnitude in the length, so every bar wears
 * the same copper, as DESIGN.md has it: a hue per row would encode nothing.
 *
 * A charge that settles a rule is drawn as an outline rather than filled:
 * that money answers a provision already counted in the charges, so filling
 * it beside an ordinary expense would read as if it were spent twice. The
 * statement gives one figure per row, and each row carries its own way into
 * the movements it sums, so there is nothing a hover could add.
 */

export interface RankRow {
  key: string
  label: string
  amount: number
  /** Where the movements behind the figure are read, when they are reachable. */
  href?: string
  /** Settles a rule: a payment against a provision, not a charge of its own. */
  settlement?: boolean
}

const ROW =
  'group grid grid-cols-[92px_1fr_78px] items-center gap-2 py-1.5 sm:grid-cols-[132px_1fr_90px] sm:gap-3'

export function ActivityRanks({
  rows,
  emptyLabel,
  /** What the settlement rows mean, said once under the ranking that shows them. */
  note,
}: {
  rows: RankRow[]
  emptyLabel: string
  note?: string
}) {
  if (rows.length === 0) return <p className="py-3 text-[13px] text-faint">{emptyLabel}</p>

  const peak = Math.max(...rows.map((r) => Math.abs(r.amount)), 1)

  return (
    <div className="flex flex-col">
      {rows.map((row) => {
        const inner = (
          <>
            <span className="truncate text-[12.5px] text-muted-foreground group-hover:text-foreground">
              {row.label}
            </span>
            <span className="flex h-4 items-center">
              <span
                className={`h-3 min-w-0.5 rounded-sm ${row.settlement ? 'border border-dashed' : ''}`}
                style={{
                  width: `${(Math.abs(row.amount) / peak) * 100}%`,
                  background: row.settlement ? 'transparent' : 'var(--chart-1)',
                  borderColor: row.settlement ? 'var(--chart-1)' : undefined,
                }}
              />
            </span>
            <span className="text-right font-mono text-[12.5px] font-semibold tabular">
              {eur(row.amount)}
            </span>
          </>
        )
        return row.href ? (
          <Link
            key={row.key}
            href={row.href}
            className={`${ROW} -mx-2 rounded-md px-2 hover:bg-secondary/40`}
          >
            {inner}
          </Link>
        ) : (
          <div key={row.key} className={`${ROW} -mx-2 px-2`}>
            {inner}
          </div>
        )
      })}
      {note && rows.some((r) => r.settlement) && <p className="pt-2 text-[11px] text-faint">{note}</p>}
    </div>
  )
}
