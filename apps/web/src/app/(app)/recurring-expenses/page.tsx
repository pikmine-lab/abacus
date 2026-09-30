import { auth } from '@abacus/core/auth'
import { today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import { listActors } from '@abacus/core/services/actors'
import { listCards } from '@abacus/core/services/cards'
import { listActivities, listCategories } from '@abacus/core/services/catalog'
import {
  COMMITMENT_SORTS,
  type CommitmentKind,
  type CommitmentMeans,
  type CommitmentSortField,
  DEFAULT_COMMITMENT_SORT,
  DEFAULT_FINANCING_SORT,
  financingSchedule,
  groupCommitments,
  listCommitmentsWithProgress,
  monthlyEquivalentEur,
  pendingOccurrences,
} from '@abacus/core/services/commitments'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { CommitmentRow, type CommitmentWithProgress } from '@/components/commitment-blocks'
import { NewCommitmentForm } from '@/components/commitment-forms'
import { EntrySheet } from '@/components/entry-sheet'
import { MassFold } from '@/components/mass-fold'
import { EmptyLine, PageBody, PageHeader, Rows, Section } from '@/components/page-shell'
import { PendingOccurrences } from '@/components/pending-occurrences'
import { SortMenu } from '@/components/sort'
import { StatRow, StatTile } from '@/components/stats'
import { cardChoices } from '@/lib/movement-form-data'
import { type Sorter, sorter } from '@/lib/sort'
import { eur, frDate } from '@/lib/utils'

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
  // What each account has to cover, split by what pays it: a subscription and
  // an installment weigh the same on the account they fall on.
  const byAccount = groupCommitments(active, {
    subscriptions: subscriptionSort.current,
    financings: financingSort.current,
  })
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

  const monthlyCost = active.reduce((sum, c) => sum + monthlyEquivalentEur(c), 0)
  // In euros at the latest rate: a USD plan's remainder cannot be added as-is.
  const remainingDue = financings.reduce((sum, c) => sum + (c.progress?.remainingDueEur ?? 0), 0)
  const toCancel = subscriptions.filter((c) => c.judgment === 'to_cancel')
  const reducible = subscriptions.filter((c) => c.judgment === 'reducible')
  const savable = [...toCancel, ...reducible].reduce((sum, c) => sum + monthlyEquivalentEur(c), 0)
  const unjudged = subscriptions.filter((c) => !c.judgment).length
  const savableHint = [
    toCancel.length > 0 ? `${toCancel.length} à résilier` : null,
    reducible.length > 0 ? `${reducible.length} réductible${reducible.length > 1 ? 's' : ''}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const row = (c: CommitmentWithProgress) => (
    <CommitmentRow
      key={c.id}
      commitment={c}
      showJudgment={c.kind === 'subscription'}
      schedule={schedules.get(c.id)}
      today={today()}
      options={options}
    />
  )
  // Inside a means, each kind under its own name, with its own total and its
  // own order: the two are not read on the same criterion, so they are not
  // ranked against each other. The menu sits on the kind it orders and drives
  // that kind in every fold, as the account menus do on Accounts.
  const kind = (
    title: string,
    group: CommitmentKind<CommitmentWithProgress>,
    sort: Sorter<CommitmentSortField>,
    criteria: { field: CommitmentSortField; label: string }[],
  ) =>
    group.lines.length > 0 && (
      <div key={title} className="flex flex-col">
        <div className="flex items-center gap-2 pt-2.5">
          <p className="text-[11px] text-faint">{title}</p>
          <span className="font-mono text-[11px] text-muted-foreground tabular">
            −{eur(group.monthlyEur, 2)}
            <span className="text-faint"> /mois</span>
          </span>
          {group.lines.length > 1 && (
            <div className="ml-auto">
              <SortMenu sorter={sort} options={criteria} />
            </div>
          )}
        </div>
        <div className="flex flex-col divide-y divide-border/70">{group.lines.map(row)}</div>
      </div>
    )

  return (
    <>
      <PageHeader title="Dépenses récurrentes" description="ce qui part tout seul, tous les mois">
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
            today={today()}
          />
        </EntrySheet>
      </PageHeader>

      <PageBody>
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
            {error}
          </p>
        )}

        <StatRow>
          <StatTile
            hero
            label="Coût mensuel engagé"
            value={eur(monthlyCost, 2)}
            hint={`${eur(monthlyCost * 12)} par an`}
          />
          <StatTile
            label="Abonnements actifs"
            value={String(subscriptions.length)}
            hint={
              ended.length > 0
                ? `${ended.length} terminé${ended.length > 1 ? 's' : ''} dans l’historique`
                : undefined
            }
          />
          <StatTile
            label="Financements"
            value={financings.length > 0 ? eur(remainingDue) : 'aucun'}
            hint={
              financings.length > 0
                ? `restant dû sur ${financings.length} financement${financings.length > 1 ? 's' : ''}`
                : 'aucun paiement en cours'
            }
          />
          <StatTile
            label="Économie possible"
            value={savable > 0 ? `${eur(savable, 2)}/mois` : 'aucune'}
            hint={
              savable > 0
                ? savableHint
                : unjudged > 0
                  ? `juge tes ${unjudged} abonnements pour voir ce qui est coupable`
                  : 'tout est jugé essentiel'
            }
          />
        </StatRow>

        {pendingOut.length > 0 && (
          <Section
            title="Échéances à confirmer"
            description="confirmer crée le mouvement réel · passer avance sans mouvement (mois offert)"
          >
            <PendingOccurrences
              back={PATH}
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
          </Section>
        )}

        {active.length === 0 ? (
          <Section title="Abonnements et financements">
            <EmptyLine>
              Aucune dépense récurrente déclarée. Le bouton « Ajouter » est en haut à droite.
            </EmptyLine>
          </Section>
        ) : (
          // One section per account: what it has to cover is the question, so
          // the header carries its total and no order.
          byAccount.map((account) => (
            <Section
              key={account.accountId}
              title={accountNames.get(account.accountId) ?? ''}
              description={`${eur(account.monthlyEur, 2)} à couvrir par mois`}
            >
              <Rows>
                {account.means.map((means) => (
                  <MassFold
                    key={means.cardId ?? 'direct'}
                    label={paidBy(means, cardNames)}
                    figures={
                      <span className="shrink-0 font-mono text-[12.5px] font-semibold tabular">
                        −{eur(means.monthlyEur, 2)}
                        <span className="text-[11px] font-normal text-faint"> /mois</span>
                      </span>
                    }
                  >
                    {kind('Abonnements', means.subscriptions, subscriptionSort, SUBSCRIPTION_SORTS)}
                    {kind('Financements', means.financings, financingSort, FINANCING_SORTS)}
                  </MassFold>
                ))}
              </Rows>
            </Section>
          ))
        )}

        {ended.length > 0 && (
          <Section title="Terminés" description="résiliés ou soldés, gardés pour l’historique des prix">
            <Rows>
              {ended.map((c) => (
                <div key={c.id} className="flex items-baseline gap-3 py-2 text-faint">
                  <span className="text-[12.5px]">{c.label}</span>
                  <span className="text-[11px]">
                    {c.cancelledOn
                      ? `résilié le ${frDate(c.cancelledOn)}`
                      : `soldé le ${frDate(c.settledOn!)}`}
                  </span>
                  <span className="ml-auto font-mono text-[12.5px] tabular">{eur(Number(c.amount), 2)}</span>
                </div>
              ))}
            </Rows>
          </Section>
        )}
      </PageBody>
    </>
  )
}

/**
 * What pays a group of lines, as its fold names it. What an account pays
 * without a card is a direct debit, the ordinary case.
 */
function paidBy(means: CommitmentMeans<unknown>, cardNames: Map<string, string>): string {
  return means.cardId ? `Carte ${cardNames.get(means.cardId) ?? ''}` : 'Prélèvements'
}
