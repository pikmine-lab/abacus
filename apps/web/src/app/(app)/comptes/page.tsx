import { auth } from '@abacus/core/auth'
import type { AccountBehavior } from '@abacus/core/domain'
import { today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import { latestCheck } from '@abacus/core/services/balanceChecks'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { BalanceCheckForm } from '@/components/balance-check-form'
import { EntrySheet } from '@/components/entry-sheet'
import { ActionForm, Field, FormSelect, SubmitButton } from '@/components/forms'
import { EmptyLine, PageBody, PageHeader, Rows, Section } from '@/components/page-shell'
import { StatRow, StatTile } from '@/components/stats'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { closeAccountAction, createAccountAction } from '@/lib/actions'
import { daysBetween, eur, freshness } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Comptes' }

const STALE_CHECK_DAYS = 45

const BEHAVIOR: Record<AccountBehavior, { label: string; blurb: string }> = {
  payment: { label: 'Comptes courants', blurb: 'portent les mouvements du quotidien' },
  savings: { label: 'Épargne', blurb: 'virements et intérêts' },
  investment: { label: 'Investissement', blurb: 'opérations et positions arrivent en V2' },
}
const ORDER: AccountBehavior[] = ['payment', 'savings', 'investment']

export default async function AccountsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const now = today()

  const accounts = await listAccounts(userId)
  const checks = await Promise.all(accounts.map((a) => latestCheck(userId, a.id)))
  const state = accounts.map((account, i) => ({ account, check: checks[i] }))

  const open = state.filter((s) => !s.account.closedOn)
  const closed = state.filter((s) => s.account.closedOn)
  const wealth = open.reduce((sum, s) => sum + Number(s.account.balance), 0)
  const gaps = open.filter((s) => s.check && s.check.gap !== 0)
  const toCheck = open.filter((s) => !s.check || daysBetween(s.check.check.checkedOn, now) > STALE_CHECK_DAYS)

  const newAccountForm = (
    <EntrySheet
      label="Ajouter un compte"
      title="Nouveau compte"
      description="Ton montage bancaire réel, un compte à la fois. Un compte clos garde son historique."
    >
      <ActionForm action={createAccountAction} successLabel="Compte créé">
        <Field label="Nom">
          <Input name="name" required placeholder="Courant principal" />
        </Field>
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
          <Input name="institution" placeholder="Nom de la banque" />
        </Field>
        <SubmitButton className="self-start">Créer le compte</SubmitButton>
      </ActionForm>
    </EntrySheet>
  )

  return (
    <>
      <PageHeader title="Comptes" description="soldes calculés, confrontés à la réalité par le pointage">
        {newAccountForm}
      </PageHeader>

      <PageBody>
        {accounts.length === 0 ? (
          <EmptyLine>
            Aucun compte pour l’instant. Tout part de là : le bouton est en haut à droite.
          </EmptyLine>
        ) : (
          <>
            <StatRow>
              <StatTile
                hero
                label="Patrimoine"
                value={eur(wealth)}
                hint={`${open.length} compte${open.length > 1 ? 's' : ''} ouvert${open.length > 1 ? 's' : ''}`}
              />
              <StatTile
                label="Écarts de pointage"
                value={
                  gaps.length > 0
                    ? eur(
                        gaps.reduce((s, g) => s + Math.abs(g.check!.gap), 0),
                        2,
                      )
                    : '—'
                }
                hint={
                  gaps.length > 0
                    ? `sur ${gaps.length} compte${gaps.length > 1 ? 's' : ''} : un mouvement manque`
                    : 'le calculé colle au réel'
                }
              />
              <StatTile
                label="À pointer"
                value={String(toCheck.length)}
                hint={
                  toCheck.length > 0
                    ? `jamais pointés ou plus vieux que ${STALE_CHECK_DAYS} jours`
                    : 'tout est frais'
                }
              />
            </StatRow>

            {ORDER.filter((behavior) => open.some((s) => s.account.behavior === behavior)).map((behavior) => (
              <Section key={behavior} title={BEHAVIOR[behavior].label} description={BEHAVIOR[behavior].blurb}>
                <Rows>
                  {open
                    .filter((s) => s.account.behavior === behavior)
                    .map(({ account, check }) => (
                      <div key={account.id} className="flex flex-col gap-2 py-3">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="text-[13px] font-medium">{account.name}</span>
                          {account.institution && (
                            <span className="text-[11px] text-faint">{account.institution}</span>
                          )}
                          <span className="ml-auto font-mono text-[14px] font-semibold tabular">
                            {eur(Number(account.balance), 2)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <BalanceCheckForm accountId={account.id} />
                          <span
                            className={`text-[11.5px] ${
                              check && check.gap !== 0 ? 'text-destructive' : 'text-faint'
                            }`}
                          >
                            {check
                              ? check.gap === 0
                                ? `pointé ${freshness(check.check.checkedOn, now)} · aucun écart`
                                : `écart de ${eur(check.gap, 2)} au dernier pointage`
                              : 'jamais pointé'}
                          </span>
                          <form action={closeAccountAction} className="ml-auto">
                            <input type="hidden" name="accountId" value={account.id} />
                            <Button
                              variant="ghost"
                              size="sm"
                              type="submit"
                              className="h-7 text-[12px] text-muted-foreground hover:text-destructive"
                            >
                              Clore
                            </Button>
                          </form>
                        </div>
                      </div>
                    ))}
                </Rows>
              </Section>
            ))}

            {closed.length > 0 && (
              <Section title="Comptes clos" description="l’historique survit au montage bancaire du moment">
                <Rows>
                  {closed.map(({ account }) => (
                    <div key={account.id} className="flex items-baseline gap-3 py-2 text-faint">
                      <span className="text-[12.5px]">{account.name}</span>
                      <span className="text-[11px]">clos le {account.closedOn}</span>
                      <span className="ml-auto font-mono text-[12.5px] tabular">
                        {eur(Number(account.balance), 2)}
                      </span>
                    </div>
                  ))}
                </Rows>
              </Section>
            )}
          </>
        )}
      </PageBody>
    </>
  )
}
