import type { PeriodUnit } from '@abacus/core/domain'
import { monthlyEquivalentEur } from '@abacus/core/services/commitments'
import { CreditCardIcon } from 'lucide-react'
import type { CommitmentWithProgress } from '@/components/commitment-blocks'
import { type CommitmentOptions, JudgmentSelect } from '@/components/commitment-forms'
import { CommitmentRowActions } from '@/components/commitment-row-actions'
import { ExpenseFold, FoldChevron } from '@/components/expense-fold'
import { ExpenseRail, ExpenseRailAxis, type RailMark } from '@/components/expense-rail'
import type { ScheduleLine } from '@/components/financing-schedule-form'
import { ProgressRing } from '@/components/progress-ring'
import { cn, eur, frDate, money } from '@/lib/utils'

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
          <ExpenseRailAxis today={today} />
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
  return (
    <span className={cn('font-mono whitespace-nowrap tabular', className)}>
      −{eur(value, 2)}
      <span className="font-sans text-[11px] font-normal text-faint">/mois</span>
    </span>
  )
}

const RHYTHM: Record<PeriodUnit, [one: string, many: (n: number) => string]> = {
  week: ['chaque semaine', (n) => `toutes les ${n} semaines`],
  month: ['chaque mois', (n) => `tous les ${n} mois`],
  year: ['chaque année', (n) => `tous les ${n} ans`],
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
  const financing = c.kind === 'financing'
  const ring = financing && c.progress !== null
  const foreign = c.currency !== 'EUR'
  const monthly = c.periodUnit === 'month' && c.periodCount === 1
  // Amounts read in the billing currency; only the monthly hint converts.
  const inCurrency = (value: number, decimals = 0) =>
    foreign ? money(value, c.currency, decimals) : eur(value, decimals)
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
    cardId: c.cardId ?? undefined,
  }
  const [one, many] = RHYTHM[c.periodUnit]
  const attributes = [
    cardName && (
      <span key="card" className="inline-flex items-center gap-1">
        <CreditCardIcon aria-hidden className="size-3" />
        {cardName}
      </span>
    ),
    (!monthly || foreign) && (
      <span key="rhythm">
        {c.periodCount === 1 ? one : many(c.periodCount)}
        {c.amountEur !== null && ` · ≈ ${eur(monthlyEquivalentEur(c), 2)}/mois`}
      </span>
    ),
    // A move already declared: the only place it shows before its date.
    c.nextAccountMove && (
      <span key="move">
        passe sur {accountName(c.nextAccountMove.accountId)} le {frDate(c.nextAccountMove.effectiveOn)}
      </span>
    ),
    c.progress && (
      <span key="plan">
        {c.progress.paidInstallments} sur {c.installmentsTotal} ·{' '}
        <span className="whitespace-nowrap">
          reste{' '}
          <span className="font-mono text-muted-foreground tabular">
            {inCurrency(c.progress.remainingDue)}
          </span>
        </span>{' '}
        <span className="whitespace-nowrap">sur {inCurrency(Number(c.totalAmount))}</span>
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
    <div className={cn(COLUMNS, 'py-2.5')}>
      <div className={cn(NAME_CELL, 'flex min-w-0 items-center gap-3')}>
        {ring && <ProgressRing done={c.progress!.paidInstallments} total={c.installmentsTotal ?? 0} />}
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-[13.5px] font-medium">{c.label}</p>
          {/* Beside the ring with the name it qualifies, once the row is wide. */}
          {attributeLine('hidden @4xl:flex')}
        </div>
      </div>
      {attributeLine('col-span-3 col-start-1 row-start-2 -mt-1 flex @4xl:hidden')}
      <div className={cn('col-start-1 @4xl:col-start-2 @4xl:row-start-1', below)}>
        <ExpenseRail name={c.label} marks={marks} today={today} />
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
