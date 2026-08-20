import { auth } from '@abacus/core/auth'
import { today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import { listActors } from '@abacus/core/services/actors'
import { listCategories } from '@abacus/core/services/catalog'
import {
  listCommitmentsWithProgress,
  monthlyEquivalent,
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

export const metadata = { title: 'Revenus récurrents' }

const PATH = '/revenus-recurrents'

export default async function RecurringIncomePage({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const { erreur } = await searchParams

  const [commitments, pending, accounts, actors, categories] = await Promise.all([
    listCommitmentsWithProgress(userId, false),
    pendingOccurrences(userId),
    listAccounts(userId),
    listActors(userId),
    listCategories(userId),
  ])

  const incoming = commitments.filter((c) => c.direction === 'incoming')
  const active = incoming.filter((c) => !c.cancelledOn)
  const stopped = incoming.filter((c) => c.cancelledOn)
  const pendingIn = pending.filter((p) => p.commitment.direction === 'incoming')

  const monthly = active.reduce((sum, c) => sum + monthlyEquivalent(c), 0)

  return (
    <>
      <PageHeader title="Revenus récurrents" description="ce qui rentre tout seul : salaire, loyers, rentes">
        <EntrySheet
          label="Ajouter"
          title="Nouveau revenu récurrent"
          description="Même moteur d’échéances que les abonnements, sens inverse : l’app te proposera de confirmer chaque versement."
        >
          <NewCommitmentForm
            direction="incoming"
            accounts={accounts.filter((a) => !a.closedOn).map((a) => ({ id: a.id, name: a.name }))}
            actors={actors.map((a) => ({ id: a.id, name: a.name }))}
            categories={categories.map((c) => ({ id: c.id, name: c.name }))}
            today={today()}
          />
        </EntrySheet>
      </PageHeader>

      <PageBody>
        {erreur && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
            {erreur}
          </p>
        )}

        <StatRow>
          <StatTile
            hero
            label="Revenu récurrent"
            value={`${eur(monthly, 2)}/mois`}
            hint={`${eur(monthly * 12)} par an`}
          />
          <StatTile
            label="Sources actives"
            value={String(active.length)}
            hint={
              stopped.length > 0 ? `${stopped.length} arrêtée${stopped.length > 1 ? 's' : ''}` : undefined
            }
          />
          <StatTile
            label="À confirmer"
            value={String(pendingIn.length)}
            hint={
              pendingIn.length > 0 ? `attendu depuis le ${frDate(pendingIn[0]!.dueOn)}` : 'tout est à jour'
            }
          />
        </StatRow>

        {pendingIn.length > 0 && (
          <Section
            title="Versements à confirmer"
            description="corrige le montant s’il diffère : c’est comme ça qu’on voit une prime ou une hausse"
          >
            <PendingOccurrences
              retour={PATH}
              items={pendingIn.map((p) => ({
                commitmentId: p.commitment.id,
                label: p.commitment.label,
                dueOn: p.dueOn,
                amount: Number(p.commitment.amount),
                incoming: true,
              }))}
            />
          </Section>
        )}

        <Section title="Sources" description="montant, périodicité et prochaine échéance">
          {active.length === 0 ? (
            <EmptyLine>
              Aucun revenu récurrent déclaré. Ton salaire ici, et la projection devient utile.
            </EmptyLine>
          ) : (
            <Rows>
              {[...active]
                .sort((a, b) => monthlyEquivalent(b) - monthlyEquivalent(a))
                .map((c) => (
                  <CommitmentRow key={c.id} commitment={c} showJudgment={false} />
                ))}
            </Rows>
          )}
        </Section>

        {stopped.length > 0 && (
          <Section title="Arrêtés" description="gardés pour l’historique">
            <Rows>
              {stopped.map((c) => (
                <div key={c.id} className="flex items-baseline gap-3 py-2 text-faint">
                  <span className="text-[12.5px]">{c.label}</span>
                  <span className="text-[11px]">arrêté le {frDate(c.cancelledOn!)}</span>
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
