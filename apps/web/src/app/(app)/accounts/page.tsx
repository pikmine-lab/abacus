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
import { AccountFold } from '@/components/account-fold'
import { AccountRowActions, PendingCheck } from '@/components/account-row-actions'
import { AmountInput } from '@/components/amount-input'
import type { CheckEntry } from '@/components/balance-check-history'
import { BankCard } from '@/components/bank-card'
import { CardActions } from '@/components/card-forms'
import { CheckRail, CheckRailAxis } from '@/components/check-rail'
import { ActionCard, Figure } from '@/components/composition'
import { EntrySheet } from '@/components/entry-sheet'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import { EmptyLine, PageBody, PageHeader } from '@/components/page-shell'
import { SortMenu } from '@/components/sort'
import { createAccountAction } from '@/lib/actions'
import { sorter } from '@/lib/sort'
import { cn, daysBetween, eur, frDate, frMonthLong } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Comptes' }

const STALE_CHECK_DAYS = 45

/**
 * One word per kind of account. Only the investment block qualifies its
 * balances, because they are its cash and not what it holds: the holdings
 * are in Placements, where its arrow leads.
 */
const BEHAVIOR: Record<
  AccountBehavior,
  { label: string; qualifier?: string; href?: string; hrefLabel?: string }
> = {
  payment: { label: 'Courants' },
  savings: { label: 'Épargne' },
  investment: {
    label: 'Investissement',
    qualifier: 'espèces',
    href: '/investments?from=accounts',
    hrefLabel: 'Placements',
  },
}
const ORDER: AccountBehavior[] = ['payment', 'savings', 'investment']

/**
 * The columns every list of the page shares, its header included, so the
 * rails and the balances line up from one kind of account to the next. When
 * the list is too narrow for a rail beside the name, the rail passes under it.
 */
const COLUMNS =
  'grid w-full grid-cols-[minmax(0,1fr)_8.5rem_1.75rem] items-center gap-x-4 gap-y-1.5 @xl:grid-cols-[minmax(0,1fr)_minmax(9rem,14rem)_8.5rem_1.75rem]'
const NAME_CELL = 'col-start-1 row-start-1'
const RAIL_CELL = 'col-start-1 row-start-2 @xl:col-start-2 @xl:row-start-1'
const BALANCE_CELL = 'col-start-2 row-start-1 text-right @xl:col-start-3'
const MENU_CELL = 'col-start-3 row-start-1 @xl:col-start-4'

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
  // Where a card can be declared: an open current account.
  const cardAccounts = open
    .filter((s) => s.account.behavior === 'payment')
    .map((s) => ({ id: s.account.id, name: s.account.name }))
  // What waits on a check: an open gap first, since it says an entry is
  // missing; then the accounts never pointed, then the oldest checks.
  const age = (s: (typeof open)[number]) =>
    s.check ? daysBetween(s.check.check.checkedOn, now) : Number.MAX_SAFE_INTEGER
  const hasGap = (s: (typeof open)[number]) => (s.check && s.check.openGap !== 0 ? 0 : 1)
  const toCheck = open
    .filter((s) => hasGap(s) === 0 || age(s) > STALE_CHECK_DAYS)
    .sort((a, b) => hasGap(a) - hasGap(b) || age(b) - age(a))

  const newAccountForm = (
    <EntrySheet
      label="Ajouter un compte"
      title="Nouveau compte"
      description="Un compte qui existait déjà part de son solde d’ouverture, qui n’est pas un revenu."
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

  const menu = ({ account, checks }: (typeof state)[number], isClosed?: boolean) => (
    <AccountRowActions
      accountId={account.id}
      name={account.name}
      institution={account.institution ?? ''}
      behavior={account.behavior}
      openingBalance={account.openingBalance}
      openedOn={account.openedOn}
      computedBalance={Number(account.balance)}
      closed={isClosed}
      checks={checkEntries(checks)}
      settleOptions={settleOptions}
      newCard={
        account.behavior === 'payment' && !isClosed ? { accounts: cardAccounts, today: now } : undefined
      }
    />
  )

  return (
    <>
      <PageHeader title="Comptes">{newAccountForm}</PageHeader>

      <PageBody>
        {accounts.length === 0 ? (
          <EmptyLine>Aucun compte pour l’instant : tout part du premier.</EmptyLine>
        ) : (
          <>
            {/* The figure that dominates, beside what keeps it honest: the
                accounts whose balance is not known to hold. */}
            <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start">
              <Figure
                hero
                label="Patrimoine"
                value={wealth}
                note={
                  missing > 0
                    ? `${eur(missing)} d’apports non déclarés : pointe les espèces du compte`
                    : holdings.value > 0
                      ? `dont ${eur(holdings.value)} de placements, au dernier cours`
                      : undefined
                }
              />
              {toCheck.length > 0 && (
                <ActionCard label="À pointer">
                  {toCheck.map(({ account, check, checks }) => (
                    <PendingCheck
                      key={account.id}
                      accountId={account.id}
                      name={account.name}
                      computedBalance={Number(account.balance)}
                      checks={checkEntries(checks)}
                      settleOptions={settleOptions}
                      gap={!!check && check.openGap !== 0}
                      detail={
                        !check
                          ? 'jamais pointé'
                          : check.openGap !== 0
                            ? `écart de ${eur(Math.abs(check.openGap), 2)} au ${frDate(check.check.checkedOn)}`
                            : `pointé le ${frDate(check.check.checkedOn)}`
                      }
                    />
                  ))}
                </ActionCard>
              )}
            </div>

            <div className="@container flex flex-col gap-8">
              {ORDER.filter((behavior) => open.some((s) => s.account.behavior === behavior)).map(
                (behavior) => {
                  const rows = open.filter((s) => s.account.behavior === behavior)
                  return (
                    <AccountList
                      key={behavior}
                      {...BEHAVIOR[behavior]}
                      sort={rows.length > 1 && <SortMenu sorter={sort} options={SORT_OPTIONS} />}
                    >
                      {rows.map((row) => {
                        const { account, checks } = row
                        // A card debits a current account and is listed under it.
                        const own = cards.filter((c) => c.accountId === account.id)
                        // A debit to state is work to do: it never waits behind a fold.
                        const toValidate = own.some((c) => c.pending.some((st) => st.dueOn <= now))
                        const line = (
                          <div key={account.id} className={COLUMNS}>
                            <div className={cn(NAME_CELL, 'flex min-w-0 flex-col gap-0.5')}>
                              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                <span className="text-[13.5px] font-medium">{account.name}</span>
                                {account.institution && (
                                  <span className="text-[11.5px] text-faint">{account.institution}</span>
                                )}
                                {own.length > 0 && (
                                  <span className="flex items-center gap-1 self-center text-[11.5px] text-muted-foreground">
                                    <CreditCardIcon className="size-3.5" />
                                    {own.length} carte{own.length > 1 ? 's' : ''}
                                    <ChevronRightIcon className="size-3 text-faint transition-transform group-open/account:rotate-90" />
                                  </span>
                                )}
                                {/* Said here only while the fold hides the statement that says it. */}
                                {toValidate && (
                                  <span className="self-center text-[11.5px] text-primary group-open/account:hidden">
                                    relevé à valider
                                  </span>
                                )}
                              </div>
                            </div>
                            {/* The rail says when; a gap or a missing check is worded once, in the card above. */}
                            <div data-keeps-fold className={RAIL_CELL}>
                              <CheckRail
                                name={account.name}
                                checks={checkEntries(checks)}
                                today={now}
                                staleDays={STALE_CHECK_DAYS}
                              />
                            </div>
                            <span className={cn(BALANCE_CELL, 'font-mono text-[14px] font-semibold tabular')}>
                              {eur(Number(account.balance), 2)}
                            </span>
                            <div data-keeps-fold className={MENU_CELL}>
                              {menu(row)}
                            </div>
                          </div>
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
                          <div key={account.id} className="py-3">
                            {line}
                          </div>
                        )
                      })}
                    </AccountList>
                  )
                },
              )}

              {closed.length > 0 && (
                <AccountList
                  label="Clos"
                  axis={false}
                  sort={closed.length > 1 && <SortMenu sorter={sort} options={SORT_OPTIONS} />}
                >
                  {closed.map((row) => (
                    <div key={row.account.id} className={cn(COLUMNS, 'py-2.5 text-faint')}>
                      <span className={cn(NAME_CELL, 'truncate text-[13px]')}>{row.account.name}</span>
                      <span className={cn(RAIL_CELL, 'text-[11.5px]')}>
                        clos le {frDate(row.account.closedOn!)}
                      </span>
                      <span className={cn(BALANCE_CELL, 'font-mono text-[13px] tabular')}>
                        {eur(Number(row.account.balance), 2)}
                      </span>
                      <div className={MENU_CELL}>{menu(row, true)}</div>
                    </div>
                  ))}
                </AccountList>
              )}
            </div>
          </>
        )}
      </PageBody>
    </>
  )
}

/**
 * The accounts of one kind, named by one word. Its header is set on the
 * list's own columns: the name over the names, the rail's scale over the
 * rails, the order over the balances it reorders.
 */
function AccountList({
  label,
  qualifier,
  href,
  hrefLabel,
  axis = true,
  sort,
  children,
}: {
  label: string
  qualifier?: string
  href?: string
  hrefLabel?: string
  /** The rail's scale; a list without rails has none. */
  axis?: boolean
  sort?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section aria-label={label} className="flex min-w-0 flex-col">
      <div className={cn(COLUMNS, 'border-b border-border pb-2')}>
        <div className={cn(NAME_CELL, 'flex items-center gap-2')}>
          <h2 className="text-[13px] font-medium text-muted-foreground">{label}</h2>
          {qualifier && <span className="text-[11.5px] text-faint">{qualifier}</span>}
          {href && (
            <Link
              href={href}
              aria-label={hrefLabel ?? label}
              className="rounded-md p-1 text-faint transition-colors hover:bg-secondary/60 hover:text-primary"
            >
              <ArrowUpRightIcon className="size-3.5" />
            </Link>
          )}
        </div>
        {axis && (
          <div className={RAIL_CELL}>
            <CheckRailAxis staleDays={STALE_CHECK_DAYS} />
          </div>
        )}
        {sort && (
          <div className="col-span-2 col-start-2 row-start-1 justify-self-end @xl:col-start-3">{sort}</div>
        )}
      </div>
      <div className="flex flex-col divide-y divide-border/70 border-b border-border">{children}</div>
    </section>
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
                    // The amount first, then where its cycle stands: two lines,
                    // so neither wraps into the other on a card's width.
                    <Link
                      key={st.id}
                      href={`/accounts/cards/${card.id}?from=accounts#statement-${st.id}`}
                      className="group -mx-1.5 flex flex-col rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-secondary/40"
                    >
                      <span className="flex items-center gap-1 font-mono text-[12.5px] text-foreground tabular">
                        −{eur(Number(st.amount), 2)}
                        <ArrowUpRightIcon className="size-3.5 text-faint group-hover:text-primary" />
                      </span>
                      <span>
                        {closed
                          ? `débit attendu le ${frDate(st.dueOn)}`
                          : `en cours jusqu’au ${frDate(st.cutOffOn)}`}
                        {due && <span className="text-primary"> · à{' '}valider</span>}
                      </span>
                    </Link>
                  )
                })}
                {deferred && card.pending.length === 0 && <span className="text-faint">rien en attente</span>}
                {deferred && (
                  <span className="text-faint">
                    arrêté {dayLabel(card.statementDay!)}, prélevé {dayLabel(card.debitDay!)}
                  </span>
                )}
                {expired && <span className="text-muted-foreground">expirée</span>}
                {expiring && (
                  <span className="text-muted-foreground">expire fin {frMonthLong(card.expiryMonth)}</span>
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
