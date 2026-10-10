import type { HeldPosition, PositionMass, PositionSortField } from '@abacus/core/services/investments'
import { ChevronRightIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AssetMenu } from '@/components/investment-forms'
import { MassLight, MassStrip } from '@/components/mass-strip'
import { RowArrow } from '@/components/page-shell'
import { SortColumn, SortMenu } from '@/components/sort'
import { type Format, useFormat } from '@/lib/format'
import type { Sorter } from '@/lib/sort'
import { cn } from '@/lib/utils'

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

/**
 * When the price was made, to the minute. Euronext is 15 minutes delayed at
 * best, imposed by its licence, so freshness cannot be gained: it is declared
 * instead, and a number without its hour would be read as "now".
 */
function priceStamp(at: Date | null, manual: boolean, format: Format, enteredOn: (day: string) => string) {
  if (!at) return null
  const day = at.toLocaleDateString(format.locale, { day: '2-digit', month: '2-digit' })
  if (manual) return enteredOn(day)
  return `${day} ${at.toLocaleTimeString(format.locale, { hour: '2-digit', minute: '2-digit' })}`
}

/** The direction in an arrow and a sign, the colour only reinforcing them. */
function Gain({ value, strong }: { value: string | null; strong?: boolean }) {
  const format = useFormat()
  if (value === null) return <span className="text-faint">—</span>
  const gain = Number(value)
  return (
    <span className={cn(gain >= 0 ? 'text-good' : 'text-destructive', strong && 'font-semibold')}>
      {gain >= 0 ? '↑' : '↓'} {format.eurSigned(gain, 2)}
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
  const t = useTranslations('investments')
  const words = useTranslations('analysis.words')
  // A mass with nothing priced has no length to draw: it stays in the list,
  // where its dash and its note say why.
  const drawn = masses.filter((m) => Number(m.value) > 0)
  const total = drawn.reduce((sum, m) => sum + Number(m.value), 0)
  // The same share as under the strip: a sliver is said to be one, not zero.
  const share = (part: number) => {
    const pct = total > 0 ? (part / total) * 100 : 0
    return pct > 0 && pct < 1 ? words('sliver') : words('percent', { value: Math.round(pct) })
  }
  const sortOptions: { field: PositionSortField; label: string }[] = [
    { field: 'value', label: t('words.value') },
    { field: 'gain', label: t('page.gainColumn') },
    { field: 'quantity', label: t('words.quantity') },
    { field: 'price', label: t('words.price') },
    { field: 'name', label: t('words.name') },
  ]
  return (
    <section aria-label={t('page.positions')} className="flex min-w-0 flex-col gap-3">
      <h2 className="text-[13px] font-medium text-muted-foreground">{t('page.positions')}</h2>
      {drawn.length > 1 && (
        <MassStrip
          label={t('page.strip')}
          parts={drawn.map((m) => ({
            id: m.nature,
            label: t(`natures.${m.nature}`),
            amount: Number(m.value),
            href: `#mass-${m.nature}`,
          }))}
        />
      )}
      <div className="flex flex-col">
        <div className={cn(COLUMNS, 'border-b border-border pb-2 text-[11px] text-faint')}>
          <SortColumn sorter={sorter} field="name" label={t('words.asset')} className="hidden @2xl:flex" />
          <SortColumn
            sorter={sorter}
            field="quantity"
            label={t('words.quantity')}
            align="right"
            className="hidden @2xl:flex"
          />
          <SortColumn
            sorter={sorter}
            field="price"
            label={t('words.price')}
            align="right"
            className="hidden @2xl:flex"
          />
          <SortColumn
            sorter={sorter}
            field="value"
            label={t('words.value')}
            align="right"
            className="hidden @2xl:flex"
          />
          <SortColumn
            sorter={sorter}
            field="gain"
            label={t('page.gainColumn')}
            align="right"
            className="hidden @2xl:flex"
          />
          {/* Narrow, the columns are gone: the order is named instead. */}
          <div className="col-span-3 justify-self-end @2xl:hidden">
            <SortMenu sorter={sorter} options={sortOptions} />
          </div>
        </div>
        {masses.map((mass) => (
          <MassLight key={mass.nature} id={mass.nature}>
            <Mass mass={mass} share={share(Number(mass.value))} showAccount={showAccount} />
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
  const t = useTranslations('investments')
  const format = useFormat()
  // Nothing priced: a zero would read as "worth nothing", where the note says
  // what is actually the case.
  const blind = mass.unpriced === mass.positions.length
  return (
    <details open id={`mass-${mass.nature}`} className="fold group/mass scroll-mt-20 border-b border-border">
      <summary className={cn(COLUMNS, 'cursor-pointer list-none py-2.5 [&::-webkit-details-marker]:hidden')}>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <ChevronRightIcon className="size-3 shrink-0 self-center text-faint transition-transform group-open/mass:rotate-90" />
            <span className="truncate text-[13.5px] font-semibold">{t(`natures.${mass.nature}`)}</span>
            {!blind && <span className="font-mono text-[12px] text-muted-foreground tabular">{share}</span>}
          </span>
          {mass.unpriced > 0 && (
            <span className="truncate pl-5 text-[11px] text-faint">
              {t('page.massUnpriced', { count: mass.unpriced })}
            </span>
          )}
        </span>
        <span className={WIDE_CELL} />
        <span className={WIDE_CELL} />
        {/* A mass of one line carries no totals: they would repeat that line. */}
        {mass.positions.length > 1 ? (
          <span className={cn(FIGURES_CELL, 'font-mono text-[13px] font-semibold tabular')}>
            <span className="text-right">{blind ? '—' : format.eur(mass.value, 2)}</span>
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
  const t = useTranslations('investments')
  const format = useFormat()
  const price = p.price === null ? null : format.eur(p.price, 2)
  const quantity = format.number(p.quantity, 8)
  const stamp = priceStamp(p.pricedAt, p.manualPrice, format, (day) => t('page.manualStamp', { day }))
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
            {quantity} × {price ?? '—'}
          </span>
          <span>{t('words.averageCost', { amount: format.eur(p.averageCost, 2) })}</span>
          <span>{stamp ?? t('page.noPrice')}</span>
        </span>
      </Link>
      <span className={cn(WIDE_CELL, 'font-mono text-[12.5px] tabular')}>{quantity}</span>
      <span className={cn(WIDE_CELL, 'font-mono text-[12.5px] text-muted-foreground tabular')}>
        {price ?? '—'}
      </span>
      <span className={cn(FIGURES_CELL, 'font-mono text-[12.5px] tabular')}>
        <span className="text-right">{p.value === null ? '—' : format.eur(p.value, 2)}</span>
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
