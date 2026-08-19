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
import { JudgmentSelect, NewCommitmentForm } from '@/components/commitment-forms'
import { Button } from '@/components/ui/button'
import { Card, CardSub, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  cancelCommitmentAction,
  changePriceAction,
  confirmOccurrenceAction,
  skipOccurrenceAction,
} from '@/lib/actions'
import { eur } from '@/lib/utils'

export const dynamic = 'force-dynamic'

function frDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y!.slice(2)}`
}

export default async function CommitmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const { erreur } = await searchParams

  const [commitments, pending, accounts, actors, categories] = await Promise.all([
    listCommitmentsWithProgress(userId),
    pendingOccurrences(userId),
    listAccounts(userId),
    listActors(userId),
    listCategories(userId),
  ])

  const active = commitments.filter((c) => !c.cancelledOn)
  const subscriptions = active.filter((c) => c.kind === 'subscription')
  const financings = active.filter((c) => c.kind === 'financing')
  const monthlyCost = active
    .filter((c) => c.direction === 'outgoing')
    .reduce((sum, c) => sum + monthlyEquivalent(c), 0)

  return (
    <main className="flex flex-col gap-3">
      {erreur && (
        <p className="rounded-lg border border-[#e66767]/40 bg-[#e66767]/10 px-3 py-2 text-xs text-[#e66767]">
          {erreur}
        </p>
      )}

      {pending.length > 0 && (
        <Card>
          <CardTitle>Échéances à confirmer</CardTitle>
          <CardSub>
            confirmer crée le mouvement réel et avance l’engagement ; passer avance sans mouvement (mois
            offert). Corrige le montant s’il diffère : c’est comme ça qu’on voit les hausses.
          </CardSub>
          <div className="mt-3 flex flex-col">
            {pending.map((p) => (
              <div
                key={`${p.commitment.id}-${p.dueOn}`}
                className="flex flex-wrap items-center gap-2 border-b border-grid py-2.5 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{p.commitment.label}</p>
                  <p className="text-[11px] text-faint">
                    attendu le {frDate(p.dueOn)} ·{' '}
                    {p.commitment.direction === 'incoming' ? 'entrée' : 'prélèvement'}
                  </p>
                </div>
                <form action={confirmOccurrenceAction} className="ml-auto flex items-center gap-2">
                  <input type="hidden" name="commitmentId" value={p.commitment.id} />
                  <Input
                    name="amount"
                    inputMode="decimal"
                    defaultValue={Number(p.commitment.amount).toFixed(2).replace('.', ',')}
                    className="h-8 w-24 text-right font-mono text-[13px]"
                    aria-label="Montant réel"
                  />
                  <Button size="sm" type="submit">
                    Confirmer
                  </Button>
                </form>
                <form action={skipOccurrenceAction}>
                  <input type="hidden" name="commitmentId" value={p.commitment.id} />
                  <Button variant="ghost" size="sm" type="submit">
                    Passer
                  </Button>
                </form>
              </div>
            ))}
          </div>
        </Card>
      )}

      <section className="grid items-start gap-3 lg:grid-cols-[1.55fr_1fr]">
        <div className="flex flex-col gap-3">
          <Card>
            <CardTitle>Abonnements et récurrents</CardTitle>
            <CardSub>
              coût mensuel engagé : {eur(monthlyCost, 2)} · le jugement prépare la revue « que couper ? »
            </CardSub>
            <div className="mt-3 flex flex-col">
              {subscriptions.length === 0 && (
                <p className="text-sm text-faint">Aucun engagement : déclare le premier ci-contre.</p>
              )}
              {subscriptions.map((sub) => (
                <div key={sub.id} className="border-b border-grid py-3 last:border-b-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {sub.label}
                        {sub.direction === 'incoming' && (
                          <span className="ml-1.5 text-[11px] text-good">entrée</span>
                        )}
                      </p>
                      <p className="text-[11px] text-faint">
                        {eur(Number(sub.amount), 2)} / {sub.periodCount > 1 ? `${sub.periodCount} ` : ''}
                        {{ week: 'semaine', month: 'mois', year: 'an' }[sub.periodUnit]} · prochaine le{' '}
                        {frDate(sub.nextDueOn)} · ≈ {eur(monthlyEquivalent(sub), 2)}/mois
                      </p>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      {sub.direction === 'outgoing' && (
                        <JudgmentSelect commitmentId={sub.id} value={sub.judgment} />
                      )}
                      <form action={cancelCommitmentAction}>
                        <input type="hidden" name="commitmentId" value={sub.id} />
                        <Button variant="ghost" size="sm" type="submit">
                          Résilier
                        </Button>
                      </form>
                    </div>
                  </div>
                  <form action={changePriceAction} className="mt-2 flex items-center gap-2">
                    <input type="hidden" name="commitmentId" value={sub.id} />
                    <Input
                      name="amount"
                      inputMode="decimal"
                      placeholder="Nouveau prix"
                      className="h-7 w-28 text-[12px]"
                      aria-label="Nouveau prix"
                    />
                    <Button variant="outline" size="sm" type="submit" className="h-7 text-[12px]">
                      Changer le prix
                    </Button>
                    <span className="text-[10.5px] text-faint">historisé, pour voir les hausses</span>
                  </form>
                </div>
              ))}
            </div>
          </Card>

          {financings.length > 0 && (
            <Card>
              <CardTitle>Financements en cours</CardTitle>
              <CardSub>s’éteignent seuls à la dernière échéance</CardSub>
              <div className="mt-3 flex flex-col">
                {financings.map((fin) => (
                  <div
                    key={fin.id}
                    className="flex items-center gap-3 border-b border-grid py-2.5 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{fin.label}</p>
                      <p className="text-[11px] text-faint">
                        {fin.progress?.paidInstallments}/{fin.installmentsTotal} échéances · prochaine le{' '}
                        {frDate(fin.nextDueOn)}
                      </p>
                    </div>
                    <span className="ml-auto text-right">
                      <span className="block font-mono text-sm font-semibold tabular-nums">
                        {eur(fin.progress?.remainingDue ?? 0)}
                      </span>
                      <span className="text-[10.5px] text-faint">restant dû</span>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <Card>
          <CardTitle>Nouvel engagement</CardTitle>
          <CardSub>abonnement, revenu récurrent ou paiement en X fois</CardSub>
          <div className="mt-3">
            <NewCommitmentForm
              accounts={accounts.filter((a) => !a.closedOn).map((a) => ({ id: a.id, name: a.name }))}
              actors={actors.map((a) => ({ id: a.id, name: a.name }))}
              categories={categories.map((c) => ({ id: c.id, name: c.name }))}
              today={today()}
            />
          </div>
        </Card>
      </section>
    </main>
  )
}
