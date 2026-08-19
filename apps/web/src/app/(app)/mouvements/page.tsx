import { auth } from '@abacus/core/auth'
import { today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import { listActors } from '@abacus/core/services/actors'
import { listActivities, listCategories } from '@abacus/core/services/catalog'
import { listMovements, outstandingAdvances } from '@abacus/core/services/movements'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { ActionForm, SubmitButton } from '@/components/forms'
import { MovementForm } from '@/components/movement-form'
import { Card, CardSub, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { createActivityAction, createCategoryAction } from '@/lib/actions'
import { eur } from '@/lib/utils'

export const dynamic = 'force-dynamic'

function frDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y!.slice(2)}`
}

export default async function MovementsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id

  const [movements, accounts, actors, categories, activities, advances] = await Promise.all([
    listMovements(userId, { limit: 60 }),
    listAccounts(userId),
    listActors(userId),
    listCategories(userId),
    listActivities(userId),
    outstandingAdvances(userId),
  ])

  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  const actorName = new Map(actors.map((a) => [a.id, a.name]))
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))

  function describe(m: (typeof movements)[number]): { who: string; detail: string } {
    if (m.kind === 'transfer')
      return {
        who: `${accountName.get(m.sourceAccountId!)} → ${accountName.get(m.targetAccountId!)}`,
        detail: 'virement interne',
      }
    if (m.kind === 'expense')
      return {
        who: actorName.get(m.targetActorId!) ?? '?',
        detail: `${accountName.get(m.sourceAccountId!)}${m.categoryId ? ` · ${categoryName.get(m.categoryId)}` : ''}`,
      }
    return {
      who: actorName.get(m.sourceActorId!) ?? '?',
      detail: `${accountName.get(m.targetAccountId!)}${m.categoryId ? ` · ${categoryName.get(m.categoryId)}` : ''}`,
    }
  }

  return (
    <main className="grid items-start gap-3 lg:grid-cols-[1fr_1.4fr]">
      <div className="flex flex-col gap-3 lg:order-2">
        <Card>
          <CardTitle>Déclarer un mouvement</CardTitle>
          <CardSub>dépense, revenu ou virement entre tes comptes (neutre)</CardSub>
          <div className="mt-3">
            <MovementForm
              accounts={accounts.filter((a) => !a.closedOn).map((a) => ({ id: a.id, name: a.name }))}
              actors={actors.map((a) => ({ id: a.id, name: a.name }))}
              categories={categories.map((c) => ({ id: c.id, name: c.name }))}
              activities={activities.map((a) => ({ id: a.id, name: a.name }))}
              advances={advances.map((a) => ({
                id: a.id,
                happenedOn: frDate(a.happenedOn),
                amount: Number(a.amount),
                remaining: Math.round((Number(a.amount) - Number(a.refunded)) * 100) / 100,
              }))}
              today={today()}
            />
          </div>
        </Card>

        <Card>
          <CardTitle>Catégories et activités</CardTitle>
          <CardSub>
            ton vocabulaire : catégories pour la nature, activités pour la sphère (ex. Freelance)
          </CardSub>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs text-faint">
                {categories.map((c) => c.name).join(' · ') || 'aucune'}
              </p>
              <ActionForm action={createCategoryAction} className="flex-row gap-2">
                <Input name="name" required placeholder="Nouvelle catégorie" className="h-8 text-[13px]" />
                <SubmitButton variant="outline" size="sm">
                  Ajouter
                </SubmitButton>
              </ActionForm>
            </div>
            <div>
              <p className="mb-2 text-xs text-faint">
                {activities.map((a) => a.name).join(' · ') || 'aucune'}
              </p>
              <ActionForm action={createActivityAction} className="flex-row gap-2">
                <Input name="name" required placeholder="Nouvelle activité" className="h-8 text-[13px]" />
                <SubmitButton variant="outline" size="sm">
                  Ajouter
                </SubmitButton>
              </ActionForm>
            </div>
          </div>
        </Card>
      </div>

      <Card className="lg:order-1">
        <CardTitle>Mouvements</CardTitle>
        <CardSub>{movements.length} derniers · les virements internes ne comptent jamais en dépense</CardSub>
        <div className="mt-3 flex flex-col">
          {movements.length === 0 && <p className="text-sm text-faint">Rien de déclaré pour l’instant.</p>}
          {movements.map((m) => {
            const { who, detail } = describe(m)
            return (
              <div
                key={m.id}
                className="flex items-baseline gap-3 border-b border-grid py-2.5 last:border-b-0"
              >
                <span className="w-14 shrink-0 font-mono text-[11px] text-faint">{frDate(m.happenedOn)}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm">{who}</p>
                  <p className="truncate text-[11px] text-faint">
                    {detail}
                    {m.note ? ` · ${m.note}` : ''}
                    {m.expectedRefundFromActorId && !m.refundClosed ? ' · avance' : ''}
                  </p>
                </div>
                <span
                  className={`ml-auto shrink-0 font-mono text-sm tabular-nums ${
                    m.kind === 'income' ? 'text-good' : m.kind === 'transfer' ? 'text-faint' : ''
                  }`}
                >
                  {m.kind === 'income' ? '+' : m.kind === 'expense' ? '−' : '⇄ '}
                  {eur(Number(m.amount), 2)}
                </span>
              </div>
            )
          })}
        </div>
      </Card>
    </main>
  )
}
