import { monthlyEquivalentEur } from '@abacus/core/services/commitments'
import { useTranslations } from 'next-intl'
import type { CommitmentWithProgress } from '@/components/commitment-blocks'
import type { CommitmentOptions } from '@/components/commitment-forms'
import { CommitmentRail, CommitmentRailAxis } from '@/components/commitment-rail'
import { CommitmentRowActions } from '@/components/commitment-row-actions'
import { useFormat } from '@/lib/format'
import type { RailMark } from '@/lib/rail-marks'
import { cn } from '@/lib/utils'

/*
 * The recurring income, on the columns of the recurring expenses so the two
 * screens read alike: the name, the rail, the amount, the menu. On a wide
 * container the rail starts where the band above splits in two (`BAND` of
 * expense-list), so the page has one right-hand column. On a narrow one the
 * rail moves under the name and the amount keeps its column.
 */
const COLUMNS =
  'grid w-full grid-cols-[minmax(0,1fr)_8.5rem_1.75rem] items-center gap-x-4 gap-y-1.5 @4xl:grid-cols-[calc(50%_-_0.25rem)_minmax(0,1fr)_8.5rem_1.75rem]'
const NAME_CELL = 'col-start-1 row-start-1'
const RAIL_CELL = 'col-start-1 row-start-2 @4xl:col-start-2 @4xl:row-start-1'
const AMOUNT_CELL = 'col-start-2 row-start-1 text-right @4xl:col-start-3'
const MENU_CELL = 'col-start-3 row-start-1 @4xl:col-start-4'

/**
 * What lands on one account, under its name. Two levels, account and line,
 * with no kind between them: income has one. The header is set on the list's
 * own columns: the name over the names, the rail's scale over the rails, the
 * order over the amounts it reorders. The account's total follows its name
 * only when the page passes one, which it does when the total is neither the
 * screen's figure nor the account's single line.
 */
export function AccountIncome({
  name,
  monthlyEur,
  sort,
  today,
  children,
}: {
  name: string
  monthlyEur?: number
  sort?: React.ReactNode
  today: string
  children: React.ReactNode
}) {
  const t = useTranslations('recurring')
  const format = useFormat()
  return (
    <section aria-label={name} className="min-w-0">
      <div className={cn(COLUMNS, 'border-b border-border pb-2.5')}>
        <div className={cn(NAME_CELL, 'flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5')}>
          <h2 className="truncate text-[16px] font-semibold tracking-tight">{name}</h2>
          {monthlyEur !== undefined && (
            <span className="font-mono text-[12px] whitespace-nowrap text-muted-foreground tabular">
              +{format.eur(monthlyEur, 2)}
              <span className="font-sans text-[11px] text-faint">{t('perMonth')}</span>
            </span>
          )}
        </div>
        <div className={RAIL_CELL}>
          <CommitmentRailAxis today={today} />
        </div>
        {sort && (
          <div className="col-span-2 col-start-2 row-start-1 justify-self-end whitespace-nowrap @4xl:col-start-3">
            {sort}
          </div>
        )}
      </div>
      <div className="flex flex-col divide-y divide-border/70">{children}</div>
    </section>
  )
}

/**
 * One recurring income. Under its name, only what sets it apart from the
 * others: a rhythm that is not monthly, a currency other than the euro, a
 * move already declared. Monthly is the rule of the page, so it is never
 * written; when it lands next falls on the rail.
 */
export function IncomeRow({
  commitment: c,
  marks,
  today,
  options,
}: {
  commitment: CommitmentWithProgress
  marks: RailMark[]
  today: string
  options: CommitmentOptions
}) {
  const t = useTranslations('recurring')
  const format = useFormat()
  const foreign = c.currency !== 'EUR'
  const monthly = c.periodUnit === 'month' && c.periodCount === 1
  const accountName = (id: string) => options.accounts.find((a) => a.id === id)?.name ?? ''
  // The actor field is a name (it autocompletes on existing ones), so the row
  // resolves it from the list it was handed.
  const defaults = {
    actor: options.actors.find((a) => a.id === c.actorId)?.name ?? '',
    categoryId: c.categoryId ?? '',
    activityId: c.activityId ?? '',
    // The periodicity is asked as one question, so it travels as one value.
    period: `${c.periodUnit}:${c.periodCount}`,
    engagedUntil: c.engagedUntil ?? '',
    accountId: c.accountId,
  }
  const attributes = [
    (!monthly || foreign) && (
      <span key="rhythm">
        {t('rhythm', { unit: c.periodUnit, count: c.periodCount })}
        {c.amountEur !== null &&
          ` · ${t('monthlyApprox', { amount: format.eur(monthlyEquivalentEur(c), 2) })}`}
      </span>
    ),
    // A move already declared: the only place it shows before its date.
    c.nextAccountMove && (
      <span key="move">
        {t('movesTo', {
          account: accountName(c.nextAccountMove.accountId),
          date: format.date(c.nextAccountMove.effectiveOn),
        })}
      </span>
    ),
  ].filter(Boolean)
  const described = attributes.length > 0

  return (
    // Marked so a movement tied to it can land here (CommitmentFocus).
    <div
      data-commitment={c.id}
      className={cn(COLUMNS, 'py-2.5 transition-colors data-[focused=true]:bg-secondary')}
    >
      <div className={cn(NAME_CELL, 'flex min-w-0 flex-col gap-0.5')}>
        <p className="text-[13.5px] font-medium">{c.label}</p>
        {described && (
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11.5px] text-faint">
            {attributes}
          </p>
        )}
      </div>
      <div className={RAIL_CELL}>
        <CommitmentRail name={c.label} marks={marks} today={today} />
      </div>
      <span
        className={cn(
          AMOUNT_CELL,
          'font-mono text-[13.5px] font-semibold whitespace-nowrap text-good tabular',
        )}
      >
        +{foreign ? format.money(Number(c.amount), c.currency, 2) : format.eur(Number(c.amount), 2)}
      </span>
      <div className={MENU_CELL}>
        <CommitmentRowActions
          commitmentId={c.id}
          label={c.label}
          amount={Number(c.amount)}
          currency={c.currency}
          kind={c.kind}
          incoming
          accountId={c.accountId}
          accountName={accountName(c.accountId)}
          today={today}
          options={options}
          defaults={defaults}
        />
      </div>
    </div>
  )
}
