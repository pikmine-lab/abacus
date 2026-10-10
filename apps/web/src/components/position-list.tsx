import type { HeldPosition, PositionMass, PositionSortField } from '@abacus/core/services/investments'
import { ChevronRightIcon } from 'lucide-react'
import Link from 'next/link'
import { AssetMenu } from '@/components/investment-forms'
import { MassLight, MassStrip } from '@/components/mass-strip'
import { RowArrow } from '@/components/page-shell'
import { SortColumn, SortMenu } from '@/components/sort'
import { NATURE_LABEL } from '@/lib/nature'
import type { Sorter } from '@/lib/sort'
import { cn, eur, eurSigned, share } from '@/lib/utils'

/*
 * The holdings of every account, by mass, under the strip that weighs them.
 * One set of columns for the header, the masses and their lines, so a figure
 * read down the list never moves. On a wide container they take the split of
 * the band above (the name half, then the figures), so the page has a single
 * right-hand column; narrower, the quantity and the price pass under the name
 * and the value keeps its column with the gain under it.
 */
const COLUMNS =
  'grid w-full grid-cols-[minmax(0,1fr)_auto_3.25rem] items-center gap-x-4 @2xl:grid-cols-[minmax(0,1fr)_5rem_6.5rem_7.5rem_7.5rem_3.25rem] @4xl:grid-cols-[calc(50%_-_0.25rem)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_3.25rem]'
/** Hidden while narrow: said under the name instead. */
const WIDE_CELL = 'hidden text-right @2xl:block'
/** Value over gain while narrow, two columns once wide. */
const FIGURES_CELL = 'flex flex-col items-end gap-0.5 @2xl:contents'

const SORT_OPTIONS: { field: PositionSortField; label: string }[] = [
  { field: 'value', label: 'Valorisation' },
  { field: 'gain', label: '+/− value' },
  { field: 'quantity', label: 'Quantité' },
  { field: 'price', label: 'Cours' },
  { field: 'name', label: 'Nom' },
]

/** Quantities are not money: they keep their own precision, trailing zeros cut. */
export function quantity(value: string): string {
  return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 8 })
}

/**
 * When the price was made, to the minute. Euronext is 15 minutes delayed at
 * best, imposed by its licence, so freshness cannot be gained: it is declared
 * instead, and a number without its hour would be read as "now".
 */
function priceStamp(at: Date | null, manual: boolean): string {
  if (!at) return 'aucun cours connu'
  const day = at.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
  if (manual) return `saisi le ${day}`
  return `${day} ${at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}

/** The direction in an arrow and a sign, the colour only reinforcing them. */
function Gain({ value, strong }: { value: string | null; strong?: boolean }) {
  if (value === null) return <span className="text-faint">—</span>
  const gain = Number(value)
  return (
    <span className={cn(gain >= 0 ? 'text-good' : 'text-destructive', strong && 'font-semibold')}>
      {gain >= 0 ? '↑' : '↓'} {eurSigned(gain, 2)}
    </span>
  )
}

export function PositionList({
  masses,
  sorter,
  showAccount,
}: {
  masses: PositionMass<HeldPosition>[]
  sorter: Sorter<PositionSortField>
  /** Whether a line names its account: not when a single account holds them all. */
  showAccount: boolean
}) {
  // A mass with nothing priced has no length to draw: it stays in the list,
  // where its dash and its note say why.
  const drawn = masses.filter((m) => Number(m.value) > 0)
  const total = drawn.reduce((sum, m) => sum + Number(m.value), 0)
  return (
    <section aria-label="Positions" className="flex min-w-0 flex-col gap-3">
      <h2 className="text-[13px] font-medium text-muted-foreground">Positions</h2>
      {drawn.length > 1 && (
        <MassStrip
          label="Répartition des positions"
          parts={drawn.map((m) => ({
            id: m.nature,
            label: NATURE_LABEL[m.nature],
            amount: Number(m.value),
            href: `#mass-${m.nature}`,
          }))}
        />
      )}
      <div className="flex flex-col">
        <div className={cn(COLUMNS, 'border-b border-border pb-2 text-[11px] text-faint')}>
          <SortColumn sorter={sorter} field="name" label="Actif" className="hidden @2xl:flex" />
          <SortColumn
            sorter={sorter}
            field="quantity"
            label="Quantité"
            align="right"
            className="hidden @2xl:flex"
          />
          <SortColumn
            sorter={sorter}
            field="price"
            label="Cours"
            align="right"
            className="hidden @2xl:flex"
          />
          <SortColumn
            sorter={sorter}
            field="value"
            label="Valorisation"
            align="right"
            className="hidden @2xl:flex"
          />
          <SortColumn
            sorter={sorter}
            field="gain"
            label="+/− value"
            align="right"
            className="hidden @2xl:flex"
          />
          {/* Narrow, the columns are gone: the order is named instead. */}
          <div className="col-span-3 justify-self-end @2xl:hidden">
            <SortMenu sorter={sorter} options={SORT_OPTIONS} />
          </div>
        </div>
        {masses.map((mass) => (
          <MassLight key={mass.nature} id={mass.nature}>
            <Mass mass={mass} share={share(Number(mass.value), total)} showAccount={showAccount} />
          </MassLight>
        ))}
      </div>
    </section>
  )
}

/**
 * One mass under a header carrying its totals in the columns its lines use:
 * the two that add up. Quantities do not (three shares and two coins are not
 * five of anything) and neither does a price, so those cells stay empty rather
 * than answer something false. Open by default: folding is a gesture one asks
 * for, not a toll. Belonging is said by distance and an indent with a hairline,
 * the indent on the name only, so the columns stay where the header put them.
 */
function Mass({
  mass,
  share,
  showAccount,
}: {
  mass: PositionMass<HeldPosition>
  share: string
  showAccount: boolean
}) {
  // Nothing priced: a zero would read as "worth nothing", where the note says
  // what is actually the case.
  const blind = mass.unpriced === mass.positions.length
  const note =
    mass.unpriced > 0
      ? `${mass.unpriced} sans cours, non valorisée${mass.unpriced > 1 ? 's' : ''}`
      : undefined
  return (
    <details open id={`mass-${mass.nature}`} className="fold group/mass scroll-mt-20 border-b border-border">
      <summary className={cn(COLUMNS, 'cursor-pointer list-none py-2.5 [&::-webkit-details-marker]:hidden')}>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <ChevronRightIcon className="size-3 shrink-0 self-center text-faint transition-transform group-open/mass:rotate-90" />
            <span className="truncate text-[13.5px] font-semibold">{NATURE_LABEL[mass.nature]}</span>
            {!blind && share && (
              <span className="font-mono text-[12px] text-muted-foreground tabular">{share}</span>
            )}
          </span>
          {note && <span className="truncate pl-5 text-[11px] text-faint">{note}</span>}
        </span>
        <span className={WIDE_CELL} />
        <span className={WIDE_CELL} />
        {/* A mass of one line carries no totals: they would repeat that line. */}
        {mass.positions.length > 1 ? (
          <span className={cn(FIGURES_CELL, 'font-mono text-[13px] font-semibold tabular')}>
            <span className="text-right">{blind ? '—' : eur(Number(mass.value), 2)}</span>
            <span className="text-right">
              <Gain value={mass.gain} strong />
            </span>
          </span>
        ) : (
          <span />
        )}
        <span />
      </summary>
      <div className="relative flex flex-col divide-y divide-border/60 pb-3">
        {/* Drawn, not bordered: a border would shift the lines off the header's columns. */}
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-3 left-[5px] w-px rounded-full bg-input"
        />
        {mass.positions.map((position) => (
          <PositionLine
            key={`${position.accountId}-${position.assetId}`}
            position={position}
            showAccount={showAccount}
          />
        ))}
      </div>
    </details>
  )
}

/**
 * One holding: what it is, where it is held, what it is worth and what it
 * made. The average cost and the hour of its price ride under the name, so the
 * two numbers one comes for are the ones that always fit.
 */
function PositionLine({ position: p, showAccount }: { position: HeldPosition; showAccount: boolean }) {
  const price = p.price === null ? null : eur(Number(p.price), 2)
  return (
    <div className={cn(COLUMNS, 'group py-2')}>
      <Link
        href={`/investments/${p.assetId}?from=investments`}
        className="flex min-w-0 flex-col gap-0.5 pl-5 outline-none focus-visible:underline"
      >
        <span className="text-[13px] group-hover:text-primary">{p.assetName}</span>
        <span className="flex flex-wrap gap-x-1.5 text-[11.5px] text-faint">
          {showAccount && <span className="text-muted-foreground">{p.accountName}</span>}
          {/* Narrow, the quantity and the price live here, the price with its hour. */}
          <span className="@2xl:hidden">
            {quantity(p.quantity)} × {price ?? '—'}
          </span>
          <span>PRU {eur(Number(p.averageCost), 2)}</span>
          <span>{priceStamp(p.pricedAt, p.manualPrice)}</span>
        </span>
      </Link>
      <span className={cn(WIDE_CELL, 'font-mono text-[12.5px] tabular')}>{quantity(p.quantity)}</span>
      <span className={cn(WIDE_CELL, 'font-mono text-[12.5px] text-muted-foreground tabular')}>
        {price ?? '—'}
      </span>
      <span className={cn(FIGURES_CELL, 'font-mono text-[12.5px] tabular')}>
        <span className="text-right">{p.value === null ? '—' : eur(Number(p.value), 2)}</span>
        <span className="text-right">
          <Gain value={p.gain} />
        </span>
      </span>
      <span className="flex items-center justify-end gap-1">
        <RowArrow />
        <AssetMenu id={p.assetId} name={p.assetName} />
      </span>
    </div>
  )
}
