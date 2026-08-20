import Link from 'next/link'
import { eur } from '@/lib/utils'

/**
 * Ranked magnitudes: one bar per category, actor or activity. Identity is
 * carried by the label and magnitude by the length, so every bar wears the
 * same copper — a hue per row would encode nothing and DESIGN.md's "color
 * follows the entity" cannot hold when the entity has no stored color.
 *
 * The solid part is net, the translucent tail is what came back as a linked
 * refund: both readings, one bar. Rows link to the movements behind them.
 */

export interface BreakdownItem {
  key: string | null
  label: string | null
  gross: number
  net: number
  count: number
}

/** What an unset dimension is called, in the words of that dimension. */
const NO_KEY: Record<string, string> = {
  categorie: 'Sans catégorie',
  acteur: 'Sans acteur',
  activite: 'Hors activité',
}

export function BreakdownBars({
  rows,
  /** Query parameter that filters the movements page by this dimension. */
  filterParam,
  from,
  emptyLabel = 'Rien sur cette période.',
  max: maxRows,
}: {
  rows: BreakdownItem[]
  filterParam: 'categorie' | 'acteur' | 'activite'
  /** Origin key, so the movements page can offer the way back. */
  from: string
  emptyLabel?: string
  max?: number
}) {
  if (rows.length === 0) return <p className="py-3 text-[13px] text-faint">{emptyLabel}</p>

  const shown = maxRows ? rows.slice(0, maxRows) : rows
  const peak = Math.max(...shown.map((r) => r.gross), 1)

  return (
    <div className="flex flex-col">
      {shown.map((row) => {
        const netPart = (row.net / peak) * 100
        const refundPart = ((row.gross - row.net) / peak) * 100
        const inner = (
          <>
            <span className="truncate text-[12.5px] text-muted-foreground group-hover:text-foreground">
              {row.label ?? NO_KEY[filterParam]}
            </span>
            <span className="flex h-4 items-center gap-[2px]">
              <span
                className="h-3 min-w-0.5 rounded-sm"
                style={{ width: `${netPart}%`, background: 'var(--chart-1)' }}
              />
              {refundPart > 0.5 && (
                <span
                  className="h-3 rounded-sm"
                  style={{ width: `${refundPart}%`, background: 'var(--chart-1)', opacity: 0.32 }}
                />
              )}
            </span>
            <span className="text-right font-mono text-[12.5px] font-semibold tabular">
              {eur(row.gross)}
              {row.net !== row.gross && (
                <span className="block text-[10.5px] font-normal text-faint">net {eur(row.net)}</span>
              )}
            </span>
          </>
        )
        const layout =
          'group grid grid-cols-[92px_1fr_78px] items-center gap-2 py-1.5 sm:grid-cols-[132px_1fr_90px] sm:gap-3'
        return row.key ? (
          <Link
            key={row.key}
            href={`/mouvements?${filterParam}=${row.key}&de=${from}`}
            className={`${layout} -mx-2 rounded-md px-2 hover:bg-secondary/40`}
            title={`${row.count} mouvement${row.count > 1 ? 's' : ''} · voir le détail`}
          >
            {inner}
          </Link>
        ) : (
          <div key="none" className={layout}>
            {inner}
          </div>
        )
      })}
      {maxRows && rows.length > maxRows && (
        <p className="pt-2 text-[11.5px] text-faint">
          + {rows.length - maxRows} autre{rows.length - maxRows > 1 ? 's' : ''} sous Analyse
        </p>
      )}
    </div>
  )
}
