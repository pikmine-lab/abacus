import { auth } from '@abacus/core/auth'
import { addPeriod, today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import { listActors } from '@abacus/core/services/actors'
import { listCards } from '@abacus/core/services/cards'
import { listActivities, listCategories } from '@abacus/core/services/catalog'
import {
  COMMITMENT_SORTS,
  type CommitmentSortField,
  DEFAULT_COMMITMENT_SORT,
  DEFAULT_FINANCING_SORT,
  financingSchedule,
  groupCommitments,
  listCommitmentsWithProgress,
  monthlyEquivalentEur,
  pendingOccurrences,
  sortCommitments,
} from '@abacus/core/services/commitments'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { CommitmentWithProgress } from '@/components/commitment-blocks'
import { NewCommitmentForm } from '@/components/commitment-forms'
import { ActionCard, Figure, FigureRow } from '@/components/composition'
import { EntrySheet } from '@/components/entry-sheet'
import { AccountExpenses, BAND, ExpenseKind, ExpenseRow } from '@/components/expense-list'
import { RAIL_DAYS, type RailMark } from '@/components/expense-rail'
import type { ScheduleLine } from '@/components/financing-schedule-form'
import { FoldSection } from '@/components/fold-section'
import { EmptyLine, PageBody, PageHeader, Rows } from '@/components/page-shell'
import { PendingOccurrences } from '@/components/pending-occurrences'
import { SortMenu } from '@/components/sort'
import { cardChoices } from '@/lib/movement-form-data'
import { type Sorter, sorter } from '@/lib/sort'
import { daysBetween, eur, frDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Dépenses récurrentes' }

const PATH = '/recurring-expenses'

const SUBSCRIPTION_SORTS: { field: CommitmentSortField; label: string }[] = [
  { field: 'monthly', label: 'Coût mensuel' },
  { field: 'amount', label: 'Montant facturé' },
  { field: 'next', label: 'Prochaine échéance' },
  { field: 'label', label: 'Nom' },
]

const FINANCING_SORTS: { field: CommitmentSortField; label: string }[] = [
  { field: 'next', label: 'Prochaine échéance' },
  { field: 'remaining', label: 'Restant dû' },
  { field: 'amount', label: 'Mensualité' },
  { field: 'label', label: 'Nom' },
]

export default async function RecurringExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const params = await searchParams
  const { error } = params
  // Two kinds, two orders, whatever account a line falls under: subscriptions
  // open on what they cost a month, the question the review exists for, and
  // financings on what falls next, which is how a plan is read.
  const subscriptionSort = sorter('subscriptions', COMMITMENT_SORTS, DEFAULT_COMMITMENT_SORT, params)
  const financingSort = sorter('financings', COMMITMENT_SORTS, DEFAULT_FINANCING_SORT, params)

  const [commitments, pending, accounts, actors, categories, activities, cards] = await Promise.all([
    // Ended ones included, cancelled or paid off: a subscription's history is
    // the point of the event log, and "what did I cut this year" is a real question.
    listCommitmentsWithProgress(userId, false),
    pendingOccurrences(userId),
    listAccounts(userId),
    listActors(userId),
    listCategories(userId),
    listActivities(userId),
    listCards(userId),
  ])

  // A scheduled placement leaves an account like a subscription does, and it is
  // no cost: it lives in Placements, with the asset it buys, and it enters
  // neither these lists nor the committed cost below.
  const outgoing = commitments.filter((c) => c.direction === 'outgoing' && c.kind !== 'investment_plan')
  const active = outgoing.filter((c) => !c.cancelledOn && !c.settledOn)
  const subscriptions = active.filter((c) => c.kind === 'subscription')
  const financings = active.filter((c) => c.kind === 'financing')
  // Cancelled, or paid off: over either way, and kept for their history.
  const ended = outgoing.filter((c) => c.cancelledOn || c.settledOn)
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]))
  const cardNames = new Map(cards.map((card) => [card.id, card.name]))
  // What each account has to cover: a subscription and an installment weigh
  // the same on the account they fall on, and the heaviest account comes first.
  const byAccount = groupCommitments(active)
  // Same references the creation form offers, so a row can be corrected too.
  const options = {
    accounts: accounts.filter((a) => !a.closedOn).map((a) => ({ id: a.id, name: a.name })),
    actors: actors.map((a) => ({ id: a.id, name: a.name })),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    activities: activities.map((a) => ({ id: a.id, name: a.name })),
    cards: cardChoices(cards),
  }
  // The plans themselves, so a financing's schedule can be revised from its row.
  const schedules = new Map(
    await Promise.all(
      financings.map(
        async (c) =>
          [
            c.id,
            (await financingSchedule(userId, c.id)).map((i) => ({
              id: i.id,
              dueOn: i.dueOn,
              amount: i.amount,
              paid: i.movementId !== null,
            })),
          ] as const,
      ),
    ),
  )
  const pendingOut = pending.filter((p) => p.commitment.direction === 'outgoing' && p.placement === null)
  const now = today()

  const cost = (lines: CommitmentWithProgress[]) => lines.reduce((sum, c) => sum + monthlyEquivalentEur(c), 0)
  // In euros at the latest rate: a USD plan's remainder cannot be added as-is.
  const remainingDue = financings.reduce((sum, c) => sum + (c.progress?.remainingDueEur ?? 0), 0)
  const toCancel = subscriptions.filter((c) => c.judgment === 'to_cancel')
  const reducible = subscriptions.filter((c) => c.judgment === 'reducible')
  const unjudged = subscriptions.filter((c) => !c.judgment).length
  const monthlyCost = cost(active)
  const savable = cost([...toCancel, ...reducible])
  // What the possible saving rests on, or why there is none yet.
  const savableNote =
    savable > 0
      ? [
          toCancel.length > 0 ? `${toCancel.length} à résilier` : null,
          reducible.length > 0 ? `${reducible.length} réductible${reducible.length > 1 ? 's' : ''}` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : unjudged > 0
        ? `${unjudged} abonnement${unjudged > 1 ? 's' : ''} à juger`
        : subscriptions.length > 0
          ? 'tout est essentiel'
          : undefined

  const row = (c: CommitmentWithProgress) => (
    <ExpenseRow
      key={c.id}
      commitment={c}
      marks={railMarks(c, schedules.get(c.id), now)}
      cardName={c.cardId ? (cardNames.get(c.cardId) ?? null) : null}
      schedule={schedules.get(c.id)}
      today={now}
      options={options}
    />
  )
  // Inside an account, each kind under its own name, with its own total and
  // its own order: the two are not read on the same criterion, so they are
  // not ranked against each other. The menu sits on the kind it orders and
  // drives that kind in every account, as the account menus do on Accounts.
  const kind = (
    label: string,
    lines: CommitmentWithProgress[],
    sort: Sorter<CommitmentSortField>,
    criteria: { field: CommitmentSortField; label: string }[],
    alone: boolean,
  ) =>
    lines.length > 0 && (
      <ExpenseKind
        key={label}
        label={label}
        monthlyEur={alone ? undefined : cost(lines)}
        sort={lines.length > 1 && <SortMenu sorter={sort} options={criteria} />}
      >
        {sortCommitments(lines, sort.current).map(row)}
      </ExpenseKind>
    )

  return (
    <>
      <PageHeader title="Dépenses récurrentes">
        <EntrySheet
          label="Ajouter"
          title="Nouvelle dépense récurrente"
          description="Un abonnement à durée ouverte, ou un paiement en X fois qui s’éteindra de lui-même."
        >
          <NewCommitmentForm
            direction="outgoing"
            accounts={options.accounts}
            actors={options.actors}
            categories={options.categories}
            activities={options.activities}
            cards={options.cards}
            today={now}
          />
        </EntrySheet>
      </PageHeader>

      {/* One container for the band and the lists, so the rails line up under its split. */}
      <PageBody className="@container">
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
            {error}
          </p>
        )}

        {/* The figure that dominates with its two parts under it, beside what
            waits on the user: the occurrences that fell. */}
        <div className={BAND}>
          <div className="flex min-w-0 flex-col gap-4">
            <Figure
              hero
              label="Coût mensuel"
              value={monthlyCost}
              decimals={2}
              per="/mois"
              note={active.length > 0 ? `soit ${eur(monthlyCost * 12)} par an` : undefined}
            />
            {/* Whole euros keep the three of them on one line beside the card;
                the cents are in the figure above and in every row below. */}
            <FigureRow compact>
              <Figure
                compact
                label="Abonnements"
                value={cost(subscriptions)}
                per="/mois"
                note={`${subscriptions.length} en cours`}
              />
              <Figure
                compact
                label="Financements"
                value={cost(financings)}
                per="/mois"
                note={financings.length > 0 ? `${eur(remainingDue)} restant dû` : 'aucun en cours'}
              />
              <Figure compact label="Économisable" value={savable} per="/mois" note={savableNote} />
            </FigureRow>
          </div>
          {pendingOut.length > 0 && (
            // Beside the figure, the card never runs longer than it: taken out
            // of the flow, it leaves the row its height, and scrolls within.
            // Stacked, it takes the room it needs.
            <div className="relative min-h-0">
              <div className="flex flex-col @4xl:absolute @4xl:inset-x-0 @4xl:top-0 @4xl:max-h-full">
                <ActionCard label="À confirmer" scrolls>
                  <PendingOccurrences
                    back={PATH}
                    aheadInPanel
                    items={pendingOut.map((p) => ({
                      commitmentId: p.commitment.id,
                      label: p.commitment.label,
                      dueOn: p.dueOn,
                      periodUnit: p.commitment.periodUnit,
                      ahead: p.ahead,
                      amount: p.amount,
                      currency: p.commitment.currency,
                      incoming: false,
                      account: accountNames.get(p.accountId) ?? '',
                    }))}
                  />
                </ActionCard>
              </div>
            </div>
          )}
        </div>

        {active.length === 0 ? (
          <EmptyLine>
            Aucune dépense récurrente : « Ajouter » en déclare une, abonnement ou paiement en plusieurs fois.
          </EmptyLine>
        ) : (
          <div className="flex flex-col gap-12">
            {byAccount.map((account) => {
              // What pays a line, a card or a direct debit, is said on the line:
              // a fold per card nested a third level for a fact one word carries.
              const subs = account.means.flatMap((m) => m.subscriptions.lines)
              const plans = account.means.flatMap((m) => m.financings.lines)
              const alone = subs.length === 0 || plans.length === 0
              return (
                <AccountExpenses
                  key={account.accountId}
                  name={accountNames.get(account.accountId) ?? ''}
                  monthlyEur={account.monthlyEur}
                  today={now}
                >
                  {kind('Abonnements', subs, subscriptionSort, SUBSCRIPTION_SORTS, alone)}
                  {kind('Financements', plans, financingSort, FINANCING_SORTS, alone)}
                </AccountExpenses>
              )
            })}
          </div>
        )}

        {ended.length > 0 && (
          <FoldSection title="Terminés" description={endedCount(ended)}>
            <Rows>
              {ended.map((c) => (
                <div key={c.id} className="flex items-baseline gap-3 py-2 text-faint">
                  <span className="text-[13px]">{c.label}</span>
                  <span className="text-[11.5px]">
                    {c.cancelledOn
                      ? `résilié le ${frDate(c.cancelledOn)}`
                      : `soldé le ${frDate(c.settledOn!)}`}
                  </span>
                  <span className="ml-auto font-mono text-[13px] tabular">{eur(Number(c.amount), 2)}</span>
                </div>
              ))}
            </Rows>
          </FoldSection>
        )}
      </PageBody>
    </>
  )
}

/** "2 résiliés · 1 soldé": what the fold holds, said before it is opened. */
function endedCount(ended: CommitmentWithProgress[]): string {
  const cancelled = ended.filter((c) => c.cancelledOn).length
  const settled = ended.length - cancelled
  return [
    cancelled > 0 && `${cancelled} résilié${cancelled > 1 ? 's' : ''}`,
    settled > 0 && `${settled} soldé${settled > 1 ? 's' : ''}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * What a line's rail places: the occurrences that reached their date and wait,
 * those that fall within the rail's window, and the first one past it when
 * nothing ahead falls inside. A financing reads its written plan, since an
 * uneven plan is not a period apart; an open-ended subscription steps from its
 * next due date by its own rhythm.
 */
function railMarks(c: CommitmentWithProgress, schedule: ScheduleLine[] | undefined, now: string): RailMark[] {
  const within = (dueOn: string) => daysBetween(now, dueOn) <= RAIL_DAYS
  const withNext = (marks: RailMark[], next: RailMark | undefined) =>
    next && !marks.some((m) => m.dueOn > now) ? [...marks, next] : marks
  if (schedule) {
    const unpaid = schedule.filter((i) => !i.paid).map((i) => ({ dueOn: i.dueOn }))
    return withNext(
      unpaid.filter((m) => within(m.dueOn)),
      unpaid.find((m) => !within(m.dueOn)),
    )
  }
  const marks: RailMark[] = []
  let dueOn = c.nextDueOn
  // Bounded: a weekly line left unconfirmed for a year still draws one late dot.
  for (let i = 0; i < 60 && within(dueOn); i++) {
    marks.push({ dueOn })
    dueOn = addPeriod(dueOn, c.periodUnit, c.periodCount)
  }
  return withNext(marks, { dueOn })
}
