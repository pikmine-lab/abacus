import { auth } from '@abacus/core/auth'
import type { AccountBehavior } from '@abacus/core/domain'
import { isValidOn } from '@abacus/core/domain/card'
import { addPeriod, endOfMonth, today } from '@abacus/core/domain/period'
import type { AccountSortField } from '@abacus/core/services/accounts'
import {
  ACCOUNT_SORTS,
  DEFAULT_ACCOUNT_SORT,
  listAccounts,
  sortAccounts,
} from '@abacus/core/services/accounts'
import { listActors } from '@abacus/core/services/actors'
import { type BalanceCheckEntry, listChecks } from '@abacus/core/services/balanceChecks'
import { type CardWithStatements, listCards } from '@abacus/core/services/cards'
import { listCategories } from '@abacus/core/services/catalog'
import { holdingsValue } from '@abacus/core/services/investments'
import { ArrowUpRightIcon, ChevronRightIcon, CreditCardIcon } from 'lucide-react'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Fragment } from 'react'
import { AccountFold } from '@/components/account-fold'
import { AccountRowActions } from '@/components/account-row-actions'
import { AmountInput } from '@/components/amount-input'
import type { CheckEntry } from '@/components/balance-check-history'
import { BankCard } from '@/components/bank-card'
import { CardActions } from '@/components/card-forms'
import { EntrySheet } from '@/components/entry-sheet'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import { EmptyLine, PageBody, PageHeader, Rows, Section } from '@/components/page-shell'
import { SortMenu } from '@/components/sort'
import { StatRow, StatTile } from '@/components/stats'
import { createAccountAction } from '@/lib/actions'
import { sorter } from '@/lib/sort'
import { daysBetween, eur, frDate, freshness, frMonthLong } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Comptes' }

const STALE_CHECK_DAYS = 45

const BEHAVIOR: Record<AccountBehavior, { label: string; blurb: string }> = {
  payment: { label: 'Comptes courants', blurb: 'portent les mouvements du quotidien' },
  savings: { label: 'Épargne', blurb: 'virements et intérêts' },
  investment: { label: 'Investissement', blurb: 'espèces ici, positions dans Placements' },
}
const ORDER: AccountBehavior[] = ['payment', 'savings', 'investment']

/**
 * What an account list orders on. The same three everywhere on the page, since
 * every section shows the same order: the control is repeated where the lists
 * are, the order behind it is one.
 */
const SORT_OPTIONS: { field: AccountSortField; label: string }[] = [
  { field: 'name', label: 'Nom' },
  { field: 'balance', label: 'Solde' },
  { field: 'checked', label: 'Dernier pointage' },
]

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

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const now = today()
  const params = await searchParams
  // One order for every section of the page: the lists are the same objects
  // split by behavior, so ranking them apart would answer "which account holds
  // the most" three times, once per group. Each section header carries the
  // control anyway, next to the list it reorders, rather than a filter row
  // above the figures holding a single menu that filters nothing.
  const sort = sorter('accounts', ACCOUNT_SORTS, DEFAULT_ACCOUNT_SORT, params)

  const [accounts, actors, categories, cards] = await Promise.all([
    listAccounts(userId),
    listActors(userId),
    listCategories(userId),
    listCards(userId),
  ])
  // A gap is settled against an actor, and filed like any other movement.
  const settleOptions = {
    actors: actors.map((a) => ({ id: a.id, name: a.name })),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
  }
  // The whole pointing history per account: the row shows the latest, and its
  // panel repairs any of them.
  const histories = await Promise.all(accounts.map((a) => listChecks(userId, a.id, 100)))
  const state = sortAccounts(
    accounts.map((account, i) => ({
      account,
      checks: histories[i]!,
      check: histories[i]![0] ?? null,
      lastCheckedOn: histories[i]![0]?.check.checkedOn ?? null,
    })),
    sort.current,
  )

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
  // Where a card can be declared: an open current account.
  const cardAccounts = open
    .filter((s) => s.account.behavior === 'payment')
    .map((s) => ({ id: s.account.id, name: s.account.name }))
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

            {ORDER.filter((behavior) => open.some((s) => s.account.behavior === behavior)).map((behavior) => {
              const rows = open.filter((s) => s.account.behavior === behavior)
              return (
                <Fragment key={behavior}>
                  <Section
                    title={BEHAVIOR[behavior].label}
                    description={BEHAVIOR[behavior].blurb}
                    action={rows.length > 1 && <SortMenu sorter={sort} options={SORT_OPTIONS} />}
                  >
                    <Rows>
                      {rows.map(({ account, check, checks }) => {
                        // A card debits a current account and is listed under it.
                        const own = cards.filter((c) => c.accountId === account.id)
                        // A debit to state is work to do: it never waits behind a fold.
                        const toValidate = own.some((c) => c.pending.some((st) => st.dueOn <= now))
                        const line = (
                          <>
                            <div className="flex min-w-0 flex-col gap-0.5">
                              <div className="flex flex-wrap items-baseline gap-2">
                                <span className="text-[13px] font-medium">{account.name}</span>
                                {account.institution && (
                                  <span className="text-[11px] text-faint">{account.institution}</span>
                                )}
                                {own.length > 0 && (
                                  <span className="flex items-center gap-1 self-center text-[11px] text-muted-foreground">
                                    <CreditCardIcon className="size-3.5" />
                                    {own.length} carte{own.length > 1 ? 's' : ''}
                                    <ChevronRightIcon className="size-3 text-faint transition-transform group-open/account:rotate-90" />
                                  </span>
                                )}
                                {toValidate && (
                                  <span className="self-center text-[11px] text-foreground">
                                    relevé à valider
                                  </span>
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
                            <div data-keeps-fold>
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
                                newCard={
                                  behavior === 'payment' ? { accounts: cardAccounts, today: now } : undefined
                                }
                              />
                            </div>
                          </>
                        )
                        return own.length > 0 ? (
                          <AccountFold key={account.id} header={line} open={toValidate}>
                            <CardGrid
                              cards={own}
                              accounts={cardAccounts}
                              accountName={account.name}
                              now={now}
                            />
                          </AccountFold>
                        ) : (
                          <div key={account.id} className="flex items-center gap-3 py-3">
                            {line}
                          </div>
                        )
                      })}
                    </Rows>
                  </Section>
                </Fragment>
              )
            })}

            {closed.length > 0 && (
              <Section
                title="Comptes clos"
                description="l’historique survit au montage bancaire du moment"
                action={closed.length > 1 && <SortMenu sorter={sort} options={SORT_OPTIONS} />}
              >
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

/**
 * The cards of one account, drawn as the objects they are, each over what it
 * still owes the account: the statements of a deferred card not validated yet.
 * Their purchases are in no balance, which is why the row above does not show
 * them. Each line says where its cycle stands and leads to the statement on
 * the card's page, the one place it is validated. An expired card stays in
 * place, greyed: it still paid what it paid.
 */
function CardGrid({
  cards,
  accounts,
  accountName,
  now,
}: {
  cards: CardWithStatements[]
  /** The open current accounts, the only ones a card is declared on. */
  accounts: { id: string; name: string }[]
  accountName: string
  now: string
}) {
  const soon = endOfMonth(addPeriod(now, 'month', 1))
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-6 gap-y-5 pt-1">
      {cards.map((card) => {
        const expired = !isValidOn(card, now)
        const deferred = card.debitMode === 'deferred'
        const expiring = !expired && endOfMonth(card.expiryMonth) <= soon
        return (
          <div key={card.id} className="flex flex-col gap-2.5">
            {/* A card leads to its page, as a position does: what it paid lives there. */}
            <Link
              href={`/accounts/cards/${card.id}?from=accounts`}
              aria-label={`Ouvrir la carte ${card.name}`}
              className="rounded-xl transition-transform outline-none hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BankCard
                id={card.id}
                name={card.name}
                accountName={accountName}
                expiryMonth={card.expiryMonth}
                deferred={deferred}
                expired={expired}
              />
            </Link>
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1 text-[11.5px]">
                {card.pending.map((st) => {
                  const closed = st.cutOffOn < now
                  const due = st.dueOn <= now
                  return (
                    <div key={st.id}>
                      <Link
                        href={`/accounts/cards/${card.id}?from=accounts#statement-${st.id}`}
                        className="group flex min-w-0 flex-wrap items-center gap-x-1 text-muted-foreground transition-colors hover:text-primary"
                      >
                        <span className="font-mono text-[12.5px] text-foreground tabular">
                          −{eur(Number(st.amount), 2)}
                        </span>
                        <span>
                          {closed
                            ? `attendus le ${frDate(st.dueOn)}`
                            : `en cours, arrêté le ${frDate(st.cutOffOn)}`}
                        </span>
                        {due && <span className="text-foreground">à valider</span>}
                        <ArrowUpRightIcon className="size-3.5 text-faint group-hover:text-primary" />
                      </Link>
                    </div>
                  )
                })}
                {deferred && card.pending.length === 0 && <span className="text-faint">rien en attente</span>}
                {deferred && (
                  <span className="text-faint">
                    arrêté {dayLabel(card.statementDay!)}, prélevé {dayLabel(card.debitDay!)}
                  </span>
                )}
                {expired && <span className="text-destructive">expirée : elle ne paie plus</span>}
                {expiring && (
                  <span className="text-muted-foreground">
                    expire fin {frMonthLong(card.expiryMonth)} : à renouveler
                  </span>
                )}
              </div>
              <CardActions
                cardId={card.id}
                accounts={accounts}
                today={now}
                defaults={{
                  name: card.name,
                  accountId: card.accountId,
                  expiryMonth: card.expiryMonth.slice(0, 7),
                  debitMode: card.debitMode,
                  statementDay: card.statementDay ?? undefined,
                  statementShift: card.statementShift ?? undefined,
                  debitDay: card.debitDay ?? undefined,
                  debitShift: card.debitShift ?? undefined,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** "le 25", or "en fin de mois" for the 31st, which is how a bank says it. */
function dayLabel(day: number): string {
  return day === 31 ? 'en fin de mois' : `le ${day}`
}
