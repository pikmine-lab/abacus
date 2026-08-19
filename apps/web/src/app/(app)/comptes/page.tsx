import { auth } from '@abacus/core/auth'
import { listAccounts } from '@abacus/core/services/accounts'
import { latestCheck } from '@abacus/core/services/balanceChecks'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { BalanceCheckForm } from '@/components/balance-check-form'
import { ActionForm, Field, FormSelect, SubmitButton } from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { closeAccountAction, createAccountAction } from '@/lib/actions'
import { eur } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const BEHAVIOR_LABEL = { payment: 'courant', savings: 'épargne', investment: 'investissement' }

export default async function AccountsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id

  const accounts = await listAccounts(userId)
  const checks = await Promise.all(accounts.map((a) => latestCheck(userId, a.id)))

  return (
    <main className="grid items-start gap-3 lg:grid-cols-[1.55fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Comptes</CardTitle>
          <CardDescription>
            le pointage compare le solde réel (lu dans ta banque) au solde calculé : c’est le garde-fou du
            déclaratif
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col">
          {accounts.length === 0 && (
            <p className="text-sm text-faint">Aucun compte : crée le premier ci-contre.</p>
          )}
          {accounts.map((account, i) => {
            const check = checks[i]
            return (
              <div key={account.id} className="border-b border-grid py-3 last:border-b-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{account.name}</span>
                  <span className="text-[11px] text-faint">
                    {BEHAVIOR_LABEL[account.behavior]}
                    {account.institution ? ` · ${account.institution}` : ''}
                    {account.closedOn ? ` · clos le ${account.closedOn}` : ''}
                  </span>
                  <span className="ml-auto font-mono text-sm font-semibold tabular-nums">
                    {eur(Number(account.balance), 2)}
                  </span>
                </div>
                {!account.closedOn && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <BalanceCheckForm accountId={account.id} />
                    <span className="text-[11px] text-faint">
                      {check
                        ? check.gap === 0
                          ? `pointé le ${check.check.checkedOn} · aucun écart`
                          : `dernier pointage : écart de ${eur(check.gap, 2)}`
                        : 'jamais pointé'}
                    </span>
                    <form action={closeAccountAction} className="ml-auto">
                      <input type="hidden" name="accountId" value={account.id} />
                      <Button variant="ghost" size="sm" type="submit">
                        Clore
                      </Button>
                    </form>
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nouveau compte</CardTitle>
          <CardDescription>ton montage bancaire réel, un compte à la fois</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={createAccountAction}>
            <Field label="Nom">
              <Input name="name" required placeholder="Fortuneo courant" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <FormSelect
                  name="behavior"
                  defaultValue="payment"
                  options={[
                    { value: 'payment', label: 'Courant' },
                    { value: 'savings', label: 'Épargne (livret)' },
                    { value: 'investment', label: 'Investissement' },
                  ]}
                />
              </Field>
              <Field label="Établissement (optionnel)">
                <Input name="institution" placeholder="Fortuneo" />
              </Field>
            </div>
            <SubmitButton className="self-start">Créer le compte</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
    </main>
  )
}
