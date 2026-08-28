import { auth } from '@abacus/core/auth'
import type { AccountBehavior } from '@abacus/core/domain'
import { today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import { listActors } from '@abacus/core/services/actors'
import { type BalanceCheckEntry, listChecks } from '@abacus/core/services/balanceChecks'
import { listCategories } from '@abacus/core/services/catalog'
import { holdingsValue } from '@abacus/core/services/investments'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { AccountRowActions } from '@/components/account-row-actions'
import { AmountInput } from '@/components/amount-input'
import type { CheckEntry } from '@/components/balance-check-history'
import { EntrySheet } from '@/components/entry-sheet'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import { EmptyLine, PageBody, PageHeader, Rows, Section } from '@/components/page-shell'
import { StatRow, StatTile } from '@/components/stats'
import { createAccountAction } from '@/lib/actions'
import { daysBetween, eur, freshness } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Comptes' }

const STALE_CHECK_DAYS = 45

const BEHAVIOR: Record<AccountBehavior, { label: string; blurb: string }> = {
  payment: { label: 'Comptes courants', blurb: 'portent les mouvements du quotidien' },
  savings: { label: 'Épargne', blurb: 'virements et intérêts' },
  investment: { label: 'Investissement', blurb: 'espèces ici, positions dans Placements' },
}
const ORDER: AccountBehavior[] = ['payment', 'savings', 'investment']

/** What the correction panel needs of a check, and nothing more. */
function checkEntries(entries: BalanceCheckEntry[]): CheckEntry[] {
  return entries.map((entry) => ({
    id: entry.check.id,
    checkedOn: entry.check.checkedOn,
    declared: Number(entry.check.declaredBalance),
    computed: Number(entry.check.computedBalance),
    gap: entry.gap,
    settled: entry.adjustmentId !== null,
  }))
}

export default async function AccountsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const now = today()

  const [accounts, actors, categories] = await Promise.all([
    listAccounts(userId),
    listActors(userId),
    listCategories(userId),
  ])
  // A gap is settled against an actor, and filed like any other movement.
  const settleOptions = {
    actors: actors.map((a) => ({ id: a.id, name: a.name })),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
  }
  // The whole pointing history per account: the row shows the latest, and its
  // panel repairs any of them.
  const histories = await Promise.all(accounts.map((a) => listChecks(userId, a.id, 100)))
  const state = accounts.map((account, i) => ({
    account,
    checks: histories[i]!,
    check: histories[i]![0] ?? null,
  }))

  const open = state.filter((s) => !s.account.closedOn)
  const closed = state.filter((s) => s.account.closedOn)
  // The balance of an investment account is its cash; its holdings are worth
  // what Placements says they are, and both belong in the wealth total.
  const holdings = await holdingsValue(userId)
  const wealth = open.reduce((sum, s) => sum + Number(s.account.balance), 0) + holdings.value
  // Cash gone negative on an investment account means the transfers that funded
  // it were never declared, which is how an existing portfolio gets typed in.
  // The total is then short by exactly that, so it says so instead of looking
  // like the holdings were not counted.
  const missing = open
    .filter((s) => s.account.behavior === 'investment' && Number(s.account.balance) < 0)
    .reduce((sum, s) => sum - Number(s.account.balance), 0)
  const gaps = open.filter((s) => s.check && s.check.openGap !== 0)
  const toCheck = open.filter((s) => !s.check || daysBetween(s.check.check.checkedOn, now) > STALE_CHECK_DAYS)

  const newAccountForm = (
    <EntrySheet
      label="Ajouter un compte"
      title="Nouveau compte"
      description="Ton montage bancaire réel, un compte à la fois. Un compte qui existait déjà porte ce qu’il contenait : son solde d’ouverture, qui n’est pas un revenu."
    >
      <ActionForm action={createAccountAction} successLabel="Compte créé">
        <TextField name="name" label="Nom" placeholder="Courant principal" />
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
        <TextField name="institution" label="Établissement (optionnel)" placeholder="Nom de la banque" />
        {/* The opening and the day it holds from travel together: one is
            meaningless without the other, and the service refuses them apart. */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Solde d’ouverture (€)" name="openingBalance">
            <AmountInput name="openingBalance" negatable placeholder="0,00" />
          </Field>
          <Field label="Ouvert le" name="openedOn">
            <DateField name="openedOn" />
          </Field>
        </div>
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
                hint={
                  missing > 0
                    ? `${eur(missing)} d’apports non déclarés : pointe les espèces du compte`
                    : holdings.value > 0
                      ? `${open.length} comptes, dont ${eur(holdings.value)} de placements`
                      : `${open.length} compte${open.length > 1 ? 's' : ''} ouvert${open.length > 1 ? 's' : ''}`
                }
              />
              <StatTile
                label="Écarts de pointage"
                value={
                  gaps.length > 0
                    ? eur(
                        gaps.reduce((s, g) => s + Math.abs(g.check!.openGap), 0),
                        2,
                      )
                    : 'aucun'
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
                    .map(({ account, check, checks }) => (
                      <div key={account.id} className="flex items-center gap-3 py-3">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="text-[13px] font-medium">{account.name}</span>
                            {account.institution && (
                              <span className="text-[11px] text-faint">{account.institution}</span>
                            )}
                          </div>
                          <span
                            className={`text-[11.5px] ${
                              check && check.openGap !== 0 ? 'text-destructive' : 'text-faint'
                            }`}
                          >
                            {check
                              ? check.openGap === 0
                                ? `pointé ${freshness(check.check.checkedOn, now)} · aucun écart`
                                : `écart de ${eur(check.openGap, 2)} au dernier pointage`
                              : 'jamais pointé'}
                          </span>
                        </div>
                        <span className="ml-auto shrink-0 font-mono text-[14px] font-semibold tabular">
                          {eur(Number(account.balance), 2)}
                        </span>
                        <AccountRowActions
                          accountId={account.id}
                          name={account.name}
                          institution={account.institution ?? ''}
                          behavior={account.behavior}
                          openingBalance={account.openingBalance}
                          openedOn={account.openedOn}
                          computedBalance={Number(account.balance)}
                          checks={checkEntries(checks)}
                          settleOptions={settleOptions}
                        />
                      </div>
                    ))}
                </Rows>
              </Section>
            ))}

            {closed.length > 0 && (
              <Section title="Comptes clos" description="l’historique survit au montage bancaire du moment">
                <Rows>
                  {closed.map(({ account, checks }) => (
                    <div key={account.id} className="flex items-center gap-3 py-2 text-faint">
                      <span className="text-[12.5px]">{account.name}</span>
                      <span className="text-[11px]">clos le {account.closedOn}</span>
                      <span className="ml-auto font-mono text-[12.5px] tabular">
                        {eur(Number(account.balance), 2)}
                      </span>
                      <AccountRowActions
                        accountId={account.id}
                        name={account.name}
                        institution={account.institution ?? ''}
                        behavior={account.behavior}
                        openingBalance={account.openingBalance}
                        openedOn={account.openedOn}
                        computedBalance={Number(account.balance)}
                        closed
                        checks={checkEntries(checks)}
                        settleOptions={settleOptions}
                      />
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
