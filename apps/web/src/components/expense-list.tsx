import { financingCoverage, withReserve } from '@abacus/core/domain/advance'
import { monthlyEquivalentEur } from '@abacus/core/services/commitments'
import { CreditCardIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { CommitmentWithProgress } from '@/components/commitment-blocks'
import { type CommitmentOptions, JudgmentSelect } from '@/components/commitment-forms'
import { CommitmentRail, CommitmentRailAxis } from '@/components/commitment-rail'
import { CommitmentRowActions } from '@/components/commitment-row-actions'
import { ExpenseFold, FoldChevron } from '@/components/expense-fold'
import type { ScheduleLine } from '@/components/financing-schedule-form'
import { ProgressRing } from '@/components/progress-ring'
import { useFormat } from '@/lib/format'
import type { RailMark } from '@/lib/rail-marks'
import { cn } from '@/lib/utils'

/*
 * The recurring expenses, set on one grid of columns so every list of the page
 * lines up: the name, the rail, the amount, the judgment, the menu. On a wide
 * container the rail starts where the band above splits in two (`BAND`), so
 * the page has one right-hand column: the first column is half the width minus
 * the difference between the band's gap and the list's. On a narrow one the
 * rail and the judgment move under the name and the amount keeps its column,
 * so the figure read down the page never moves.
 */
export const BAND = 'grid gap-6 @4xl:grid-cols-2'
const COLUMNS =
  'grid w-full grid-cols-[minmax(0,1fr)_8.5rem_1.75rem] items-center gap-x-4 gap-y-1.5 @4xl:grid-cols-[calc(50%_-_0.25rem)_minmax(0,1fr)_8.5rem_6.5rem_1.75rem]'
const NAME_CELL = 'col-start-1 row-start-1'
const RAIL_CELL = 'col-start-1 row-start-2 @4xl:col-start-2 @4xl:row-start-1'
const AMOUNT_CELL = 'col-start-2 row-start-1 text-right @4xl:col-start-3'
const MENU_CELL = 'col-start-3 row-start-1 @4xl:col-start-5'

/*
 * Three levels, each read at a glance by its own weight, never by position
 * alone: an account is a title, a kind a quieter heading with its chevron, a
 * line its name with the faint attributes under it. The rule under the
 * account is the one between lines, as under a table's header: in the field
 * outline's ink, it would read as one more rail.
 */

/**
 * What one account has to cover a month, under its name. Its header is set on
 * the list's own columns: the name over the names, the rail's scale over the
 * rails, the total over the amounts it adds up.
 */
export function AccountExpenses({
  name,
  monthlyEur,
  today,
  children,
}: {
  name: string
  monthlyEur: number
  today: string
  children: React.ReactNode
}) {
  return (
    <section aria-label={name} className="min-w-0">
      <div className={cn(COLUMNS, 'border-b border-border pb-2.5')}>
        <h2 className={cn(NAME_CELL, 'truncate text-[16px] font-semibold tracking-tight')}>{name}</h2>
        <div className={RAIL_CELL}>
          <CommitmentRailAxis today={today} />
        </div>
        <PerMonth value={monthlyEur} className={cn(AMOUNT_CELL, 'text-[15px] font-semibold')} />
      </div>
      {children}
    </section>
  )
}

/**
 * One kind of line inside an account, under its own name with its own total
 * and its own order: an open-ended cost and a plan that ends are not read on
 * the same criterion. The total follows the name, the order sits over the
 * amounts it reorders; on a narrow container the total goes under the name,
 * one block, and the order stays beside it rather than run into the total.
 * A kind folds away on its own.
 */
export function ExpenseKind({
  label,
  monthlyEur,
  sort,
  children,
}: {
  label: string
  /** Left out when the account holds this kind alone: its header already says it. */
  monthlyEur?: number
  sort?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <ExpenseFold
      className={cn(COLUMNS, 'pt-5 pb-1.5')}
      header={
        <>
          <div
            className={cn(NAME_CELL, 'flex flex-col gap-0.5 @4xl:flex-row @4xl:items-baseline @4xl:gap-3')}
          >
            {/* The height of the order's button, so the name and the order
                read on one line when the total goes under the name. */}
            <div className="flex h-7 items-center gap-2">
              <FoldChevron />
              <h3 className="text-[13px] font-semibold text-muted-foreground">{label}</h3>
            </div>
            {monthlyEur !== undefined && (
              // Under the name past the chevron: 3.5 for the chevron, 2 for the gap.
              <PerMonth value={monthlyEur} className="pl-5.5 text-[12px] text-muted-foreground @4xl:pl-0" />
            )}
          </div>
          {sort && (
            <div
              data-keeps-fold
              className="col-span-2 col-start-2 row-start-1 self-start justify-self-end whitespace-nowrap @4xl:self-center @4xl:col-span-3 @4xl:col-start-3"
            >
              {sort}
            </div>
          )}
        </>
      }
    >
      <div className="flex flex-col divide-y divide-border/70">{children}</div>
    </ExpenseFold>
  )
}

/** "−1 086,63 €/mois": a total of the page, read in the column of amounts. */
function PerMonth({ value, className }: { value: number; className?: string }) {
  const t = useTranslations('recurring')
  const format = useFormat()
  return (
    <span className={cn('font-mono whitespace-nowrap tabular', className)}>
      −{format.eur(value, 2)}
      <span className="font-sans text-[11px] font-normal text-faint">{t('perMonth')}</span>
    </span>
  )
}

/**
 * One recurring expense. Under its name, only what sets it apart from the
 * others: the card it is billed to, a rhythm that is not monthly, a move
 * already declared, how far a plan has run. Monthly is the rule of the page,
 * so it is never written; when it is next falls on the rail. On a narrow
 * container that line takes the whole width under the name rather than wrap
 * between the ring and the amount.
 *
 * The judgment stays in the row because it is an attribute, not an action,
 * and changing it in one gesture is the whole point of the "what do I cut?"
 * review. The selector says it once; no badge repeats it beside the name.
 */
export function ExpenseRow({
  commitment: c,
  marks,
  cardName,
  schedule,
  today,
  options,
}: {
  commitment: CommitmentWithProgress
  marks: RailMark[]
  /** The card it is billed to, when it is not a direct debit. */
  cardName: string | null
  /** Financings only: the written plan, revised from the row's menu. */
  schedule?: ScheduleLine[]
  today: string
  options: CommitmentOptions
}) {
  const t = useTranslations('recurring')
  const format = useFormat()
  const financing = c.kind === 'financing'
  const ring = financing && c.progress !== null
  const foreign = c.currency !== 'EUR'
  const monthly = c.periodUnit === 'month' && c.periodCount === 1
  // Amounts read in the billing currency; only the monthly hint converts.
  const inCurrency = (value: number, decimals = 0) =>
    foreign ? format.money(value, c.currency, decimals) : format.eur(value, decimals)
  const accountName = (id: string) => options.accounts.find((a) => a.id === id)?.name ?? ''
  const actorName = (id: string) => options.actors.find((a) => a.id === id)?.name ?? ''
  // Partly paid back by others: the row keeps what leaves the account and says
  // under the name what is expected back, since a net only deducts money that
  // has moved.
  const shares = c.shares
  // Claimed on its total: what came back covered of the installments paid,
  // and what came back ahead of the ones to come.
  const coverage =
    financing && c.progress
      ? financingCoverage(Number(c.progress.paidTotal), Number(c.totalAmount), shares)
      : null
  // The ring reads the reserve with the claims: both are money that covers
  // the installments, whoever sent it. The row's lines say which is which.
  // The reserve is in euros and the plan in its own currency, so a plan billed
  // in another one keeps its ring in installments.
  const ringCoverage = financing && !foreign ? withReserve(coverage, c.reserve) : coverage
  const claimants = shares
    .filter((share) => !share.perOccurrence && Number(share.refunded) > 0)
    .map((share) => actorName(share.debtorActorId))
    .join(', ')
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
    cardId: c.cardId ?? undefined,
    amount: Number(c.amount),
    total: c.totalAmount === null ? undefined : Number(c.totalAmount),
    shares: shares.map((share) => ({
      id: share.id,
      debtor: actorName(share.debtorActorId),
      amount: Number(share.amount),
      perOccurrence: share.perOccurrence,
      refunded: Number(share.refunded),
      lastRefundedOn: share.lastRefundedOn ?? undefined,
    })),
  }
  const attributes = [
    cardName && (
      <span key="card" className="inline-flex items-center gap-1">
        <CreditCardIcon aria-hidden className="size-3" />
        {cardName}
      </span>
    ),
    coverage && (coverage.covered > 0 || coverage.ahead > 0) && (
      <span key="coverage">
        {[
          coverage.covered > 0 &&
            t('coveredBy', { amount: format.eur(coverage.covered, 2), debtors: claimants }),
          coverage.ahead > 0 && t('receivedAhead', { amount: format.eur(coverage.ahead, 2) }),
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    ),
    // Money received ahead for it: what is left for the coming occurrences,
    // or, once it is over, what became an income.
    c.reserve && (
      <span key="reserve">
        {c.reserve.releasedOn
          ? t('reserveReleased', {
              amount: format.eur(Number(c.reserve.remaining), 2),
              date: format.date(c.reserve.releasedOn),
            })
          : t('reserveLeft', {
              remaining: format.eur(Number(c.reserve.remaining), 2),
              received: format.eur(Number(c.reserve.received), 2),
            })}
      </span>
    ),
    // A claim on the total that money came back on is told by the line above.
    ...shares
      .filter((share) => share.perOccurrence || !coverage || (coverage.covered === 0 && coverage.ahead === 0))
      .map((share) => (
        <span key={share.id}>
          {t(share.perOccurrence ? 'expectedBackFrom' : 'owedOnTotal', {
            share: share.perOccurrence
              ? inCurrency(Number(share.amount), 2)
              : format.eur(Number(share.amount), 2),
            debtor: actorName(share.debtorActorId),
          })}
        </span>
      )),
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
    c.progress && (
      <span key="plan">
        {t.rich('list.progress', {
          paid: c.progress.paidInstallments,
          count: c.installmentsTotal ?? 0,
          remaining: inCurrency(c.progress.remainingDue),
          total: inCurrency(Number(c.totalAmount)),
          keep: (chunks) => <span className="whitespace-nowrap">{chunks}</span>,
          amount: (chunks) => <span className="font-mono text-muted-foreground tabular">{chunks}</span>,
        })}
      </span>
    ),
  ].filter(Boolean)
  const described = attributes.length > 0
  const attributeLine = (className: string) =>
    described && (
      <p className={cn('flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11.5px] text-faint', className)}>
        {attributes}
      </p>
    )
  // With a line of attributes, the rail and the judgment go one row lower on a
  // narrow container, where the line takes the whole width under the name.
  const below = described ? 'row-start-3' : 'row-start-2'

  return (
    // Marked so a movement tied to it can land here (CommitmentFocus).
    <div
      data-commitment={c.id}
      className={cn(COLUMNS, 'py-2.5 transition-colors data-[focused=true]:bg-secondary')}
    >
      <div className={cn(NAME_CELL, 'flex min-w-0 items-center gap-3')}>
        {ring && (
          <ProgressRing
            done={c.progress!.paidInstallments}
            total={c.installmentsTotal ?? 0}
            coverage={
              ringCoverage
                ? { paid: Number(c.progress!.paidTotal), total: Number(c.totalAmount), ...ringCoverage }
                : undefined
            }
          />
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-[13.5px] font-medium">{c.label}</p>
          {/* Beside the ring with the name it qualifies, once the row is wide. */}
          {attributeLine('hidden @4xl:flex')}
        </div>
      </div>
      {attributeLine('col-span-3 col-start-1 row-start-2 -mt-1 flex @4xl:hidden')}
      <div className={cn('col-start-1 @4xl:col-start-2 @4xl:row-start-1', below)}>
        <CommitmentRail name={c.label} marks={marks} today={today} />
      </div>
      <span className={cn(AMOUNT_CELL, 'font-mono text-[13.5px] font-semibold whitespace-nowrap tabular')}>
        −{inCurrency(Number(c.amount), 2)}
      </span>
      {!financing && (
        <div
          className={cn(
            'col-span-2 col-start-2 justify-self-end @4xl:col-span-1 @4xl:col-start-4 @4xl:row-start-1',
            below,
          )}
        >
          <JudgmentSelect commitmentId={c.id} value={c.judgment} />
        </div>
      )}
      <div className={MENU_CELL}>
        <CommitmentRowActions
          commitmentId={c.id}
          label={c.label}
          amount={Number(c.amount)}
          currency={c.currency}
          kind={c.kind}
          incoming={false}
          accountId={c.accountId}
          accountName={accountName(c.accountId)}
          schedule={schedule}
          today={today}
          options={options}
          defaults={defaults}
        />
      </div>
    </div>
  )
}
