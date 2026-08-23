import { auth } from '@abacus/core/auth'
import { today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import { listActors } from '@abacus/core/services/actors'
import { listActivities, listCategories } from '@abacus/core/services/catalog'
import {
  financingSchedule,
  listCommitmentsWithProgress,
  monthlyEquivalentEur,
  pendingOccurrences,
} from '@abacus/core/services/commitments'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { CommitmentRow } from '@/components/commitment-blocks'
import { NewCommitmentForm } from '@/components/commitment-forms'
import { EntrySheet } from '@/components/entry-sheet'
import { EmptyLine, PageBody, PageHeader, Rows, Section } from '@/components/page-shell'
import { PendingOccurrences } from '@/components/pending-occurrences'
import { StatRow, StatTile } from '@/components/stats'
import { eur, frDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Dépenses récurrentes' }

const PATH = '/recurring-expenses'

export default async function RecurringExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const { error } = await searchParams

  const [commitments, pending, accounts, actors, categories, activities] = await Promise.all([
    // Cancelled ones included: a subscription's history is the point of the
    // event log, and "what did I cut this year" is a real question.
    listCommitmentsWithProgress(userId, false),
    pendingOccurrences(userId),
    listAccounts(userId),
    listActors(userId),
    listCategories(userId),
    listActivities(userId),
  ])

  const outgoing = commitments.filter((c) => c.direction === 'outgoing')
  const active = outgoing.filter((c) => !c.cancelledOn)
  const subscriptions = active.filter((c) => c.kind === 'subscription')
  const financings = active.filter((c) => c.kind === 'financing')
  const cancelled = outgoing.filter((c) => c.cancelledOn)
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]))
  // Same references the creation form offers, so a row can be corrected too.
  const options = {
    accounts: accounts.filter((a) => !a.closedOn).map((a) => ({ id: a.id, name: a.name })),
    actors: actors.map((a) => ({ id: a.id, name: a.name })),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    activities: activities.map((a) => ({ id: a.id, name: a.name })),
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
  const pendingOut = pending.filter((p) => p.commitment.direction === 'outgoing')

  const monthlyCost = active.reduce((sum, c) => sum + monthlyEquivalentEur(c), 0)
  const remainingDue = financings.reduce((sum, c) => sum + (c.progress?.remainingDue ?? 0), 0)
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
              cancelled.length > 0
                ? `${cancelled.length} résilié${cancelled.length > 1 ? 's' : ''} dans l’historique`
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
                amount: p.amount,
                currency: p.commitment.currency,
                incoming: false,
                account: accountNames.get(p.accountId) ?? '',
              }))}
            />
          </Section>
        )}

        <Section
          title="Abonnements"
          description={`${subscriptions.length} actif${subscriptions.length > 1 ? 's' : ''} · le jugement prépare la revue « que couper ? »`}
        >
          {subscriptions.length === 0 ? (
            <EmptyLine>Aucun abonnement déclaré. Le bouton « Ajouter » est en haut à droite.</EmptyLine>
          ) : (
            <Rows>
              {[...subscriptions]
                .sort((a, b) => monthlyEquivalentEur(b) - monthlyEquivalentEur(a))
                .map((c) => (
                  <CommitmentRow key={c.id} commitment={c} showJudgment options={options} today={today()} />
                ))}
            </Rows>
          )}
        </Section>

        {financings.length > 0 && (
          <Section title="Financements en cours" description="s’éteignent seuls à la dernière échéance">
            <Rows>
              {financings.map((c) => (
                <CommitmentRow
                  key={c.id}
                  commitment={c}
                  showJudgment={false}
                  schedule={schedules.get(c.id)}
                  today={today()}
                  options={options}
                />
              ))}
            </Rows>
          </Section>
        )}

        {cancelled.length > 0 && (
          <Section title="Résiliés" description="gardés pour l’historique des prix">
            <Rows>
              {cancelled.map((c) => (
                <div key={c.id} className="flex items-baseline gap-3 py-2 text-faint">
                  <span className="text-[12.5px]">{c.label}</span>
                  <span className="text-[11px]">résilié le {frDate(c.cancelledOn!)}</span>
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
