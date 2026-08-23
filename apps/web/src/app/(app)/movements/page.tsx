import { auth } from '@abacus/core/auth'
import type { MovementKind } from '@abacus/core/domain'
import { today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import { listActors } from '@abacus/core/services/actors'
import { listActivities, listCategories } from '@abacus/core/services/catalog'
import { listMovements, outstandingAdvances, selectionTotals } from '@abacus/core/services/movements'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { EntrySheet } from '@/components/entry-sheet'
import { MovementFilters } from '@/components/movement-filters'
import { MovementForm } from '@/components/movement-form'
import { MovementRowActions } from '@/components/movement-row-actions'
import { OutstandingAdvances } from '@/components/outstanding-advances'
import { FilterBar, PageBody, PageHeader, Section } from '@/components/page-shell'
import { PeriodPicker } from '@/components/period-picker'
import { ReadingTabs } from '@/components/reading-tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { resolvePeriod, resolveReading } from '@/lib/period'
import { eur, frDate, frMonth, idParam, money } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Mouvements' }

const PATH = '/movements'
const KINDS: MovementKind[] = ['expense', 'income', 'transfer']
const PAGE_SIZE = 100

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const params = await searchParams
  // A ledger opens on a window wide enough to hold something, not on the
  // first day of the month.
  const period = resolvePeriod(params, today(), '90d')

  const limit = Number(params.limit) > 0 ? Math.min(Number(params.limit), 1000) : PAGE_SIZE

  // The vocabulary first: a filter naming something this user does not own
  // (a stale link, a deleted category) is dropped rather than silently
  // returning an empty list the controls cannot explain.
  const [accounts, actors, categories, activities, advances] = await Promise.all([
    listAccounts(userId),
    listActors(userId),
    listCategories(userId),
    listActivities(userId),
    outstandingAdvances(userId),
  ])
  const known = (id: string | undefined, among: { id: string }[]) =>
    id && among.some((entry) => entry.id === id) ? id : undefined

  const filters = {
    from: period.from,
    to: period.to,
    reading: resolveReading(params),
    kind: KINDS.includes(params.type as MovementKind) ? (params.type as MovementKind) : undefined,
    accountId: known(idParam(params.account), accounts),
    categoryId: known(idParam(params.category), categories),
    actorId: known(idParam(params.actor), actors),
    activityId: known(idParam(params.activity), activities),
    search: params.q,
    advancesOnly: params.advances === '1',
  }

  const [movements, selection] = await Promise.all([
    listMovements(userId, { ...filters, limit }),
    selectionTotals(userId, filters),
  ])

  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  const actorName = new Map(actors.map((a) => [a.id, a.name]))
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))

  // The claims to settle: outside the period on purpose, an advance from four
  // months ago is exactly the one that got forgotten.
  const openAdvances = advances.map((a) => {
    const expected = Number(a.expectedRefundAmount)
    const refunded = Number(a.refunded)
    return {
      movementId: a.id,
      label: actorName.get(a.targetActorId!) ?? '?',
      happenedOn: a.happenedOn,
      debtor: actorName.get(a.expectedRefundFromActorId!) ?? '?',
      account: accountName.get(a.sourceAccountId!) ?? '?',
      expense: Number(a.amount),
      expected,
      refunded,
      remaining: Math.round((expected - refunded) * 100) / 100,
    }
  })

  const stillOwed = new Map(openAdvances.map((a) => [a.movementId, a.remaining]))
  // A column that would be empty on every row says nothing: what is owed only
  // takes its place in the table when the selection holds a live claim.
  const owedInList = movements.some((m) => stillOwed.has(m.id))

  const count = Number(selection.count)
  const openAccounts = accounts.filter((a) => !a.closedOn)
  const options = {
    accounts: openAccounts.map((a) => ({ id: a.id, name: a.name })),
    actors: actors.map((a) => ({ id: a.id, name: a.name })),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    activities: activities.map((a) => ({ id: a.id, name: a.name })),
  }

  return (
    <>
      <PageHeader title="Mouvements" description="dépenses, revenus et virements entre tes comptes">
        <EntrySheet
          label="Déclarer"
          title="Déclarer un mouvement"
          description="Le panneau reste ouvert : enchaîne les déclarations, les champs se vident à chaque fois."
        >
          <MovementForm
            {...options}
            advances={openAdvances.map((a) => ({
              id: a.movementId,
              happenedOn: frDate(a.happenedOn),
              amount: a.expected,
              remaining: a.remaining,
            }))}
            today={today()}
          />
        </EntrySheet>
      </PageHeader>

      <FilterBar>
        <PeriodPicker period={period} />
        <ReadingTabs />
        <span className="mx-1 hidden h-4 w-px bg-border sm:block" />
        <MovementFilters
          accounts={options.accounts}
          categories={options.categories}
          actors={options.actors}
          activities={options.activities}
        />
      </FilterBar>

      <PageBody className="gap-4">
        {openAdvances.length > 0 && (
          <Section
            title="Avances à rembourser"
            description="« Remboursé » écrit le revenu sur le compte qui a payé"
          >
            <OutstandingAdvances advances={openAdvances} today={today()} back={PATH} />
          </Section>
        )}

        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[12.5px]">
          <span className="text-muted-foreground">
            <span className="font-semibold tabular text-foreground">{count}</span> mouvement
            {count > 1 ? 's' : ''}
          </span>
          {Number(selection.expense) > 0 && (
            <span className="text-faint">
              dépenses{' '}
              <span className="font-mono tabular text-muted-foreground">{eur(selection.expense)}</span>
            </span>
          )}
          {Number(selection.income) > 0 && (
            <span className="text-faint">
              revenus <span className="font-mono tabular text-muted-foreground">{eur(selection.income)}</span>
            </span>
          )}
          {Number(selection.transfer) > 0 && (
            <span className="text-faint">
              virements{' '}
              <span className="font-mono tabular text-muted-foreground">{eur(selection.transfer)}</span>
            </span>
          )}
        </div>

        {movements.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-faint">
            Rien ne correspond à cette sélection. Élargis la période ou efface les filtres.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-20">Date</TableHead>
                <TableHead>Contrepartie</TableHead>
                <TableHead className="hidden sm:table-cell">Compte</TableHead>
                <TableHead className="hidden md:table-cell">Catégorie</TableHead>
                {owedInList && (
                  <TableHead className="hidden w-28 text-right md:table-cell">À rembourser</TableHead>
                )}
                <TableHead className="w-28 text-right">Montant</TableHead>
                <TableHead className="w-9 sr-only">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((m) => {
                const isTransfer = m.kind === 'transfer'
                const isIncome = m.kind === 'income'
                const counterparty = isTransfer
                  ? `${accountName.get(m.sourceAccountId!) ?? '?'} → ${accountName.get(m.targetAccountId!) ?? '?'}`
                  : (actorName.get((isIncome ? m.sourceActorId : m.targetActorId)!) ?? '?')
                const account = isTransfer
                  ? 'virement interne'
                  : (accountName.get((isIncome ? m.targetAccountId : m.sourceAccountId)!) ?? '?')
                // What is still owed, which is not the same as "was an advance":
                // a claim that came back in full has nothing left to announce.
                const owed = stillOwed.get(m.id)
                const origin = m.commitmentId
                  ? 'Ce mouvement vient d’une échéance confirmée.'
                  : m.balanceCheckId
                    ? 'Ce mouvement est un ajustement de pointage.'
                    : undefined
                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-[11.5px] text-faint">
                      {frDate(m.happenedOn)}
                      {/* Only when it differs from the date's own month: the
                          arrow is there to be noticed, not to repeat. */}
                      {m.accrualMonth && (
                        <span
                          className="block text-[10.5px] text-primary"
                          title={`Compté dans le mois de ${frMonth(m.accrualMonth)}`}
                        >
                          → {frMonth(m.accrualMonth)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-0">
                      <span className="block truncate text-[13px]">{counterparty}</span>
                      {m.note && <span className="block truncate text-[11px] text-faint">{m.note}</span>}
                    </TableCell>
                    <TableCell className="hidden text-[12px] text-muted-foreground sm:table-cell">
                      {account}
                    </TableCell>
                    <TableCell className="hidden text-[12px] text-muted-foreground md:table-cell">
                      {m.categoryId ? (categoryName.get(m.categoryId) ?? '') : ''}
                    </TableCell>
                    {owedInList && (
                      <TableCell className="hidden text-right md:table-cell">
                        {owed !== undefined && (
                          <>
                            <span className="block font-mono text-[12.5px] tabular text-primary">
                              {eur(owed, 2)}
                            </span>
                            <span className="block truncate text-[11px] text-faint">
                              {actorName.get(m.expectedRefundFromActorId!) ?? '?'}
                            </span>
                          </>
                        )}
                      </TableCell>
                    )}
                    <TableCell
                      className={`text-right font-mono text-[13px] tabular ${
                        isIncome ? 'text-good' : isTransfer ? 'text-faint' : ''
                      }`}
                    >
                      {isIncome ? '+' : isTransfer ? '' : '−'}
                      {eur(Number(m.amount), 2)}
                      {m.originalCurrency && (
                        <span className="block text-[11px] font-normal text-faint">
                          {money(Number(m.originalAmount), m.originalCurrency)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="pr-1 pl-0 text-right">
                      <MovementRowActions
                        {...options}
                        today={today()}
                        label={`${frDate(m.happenedOn)} · ${counterparty} · ${eur(Number(m.amount), 2)}`}
                        draft={{
                          id: m.id,
                          type: m.kind,
                          happenedOn: m.happenedOn,
                          amount: Number(m.amount).toFixed(2),
                          originalAmount: m.originalAmount ? Number(m.originalAmount).toFixed(2) : undefined,
                          originalCurrency: m.originalCurrency ?? undefined,
                          accountId: (isIncome ? m.targetAccountId : m.sourceAccountId) ?? '',
                          toAccountId: isTransfer ? (m.targetAccountId ?? undefined) : undefined,
                          actorName: isTransfer
                            ? undefined
                            : actorName.get((isIncome ? m.sourceActorId : m.targetActorId)!),
                          categoryId: m.categoryId ?? undefined,
                          activityId: m.activityId ?? undefined,
                          note: m.note ?? undefined,
                          accrualMonth: m.accrualMonth?.slice(0, 7),
                          refundFromActorName: m.expectedRefundFromActorId
                            ? (actorName.get(m.expectedRefundFromActorId) ?? '')
                            : undefined,
                          expectedRefundAmount: m.expectedRefundAmount
                            ? Number(m.expectedRefundAmount)
                            : undefined,
                          origin,
                        }}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}

        {count > movements.length && (
          <MoreLink params={params} limit={limit} shown={movements.length} total={count} />
        )}
      </PageBody>
    </>
  )
}

/** Plain link, so "show more" costs no client state and survives a reload. */
function MoreLink({
  params,
  limit,
  shown,
  total,
}: {
  params: Record<string, string | undefined>
  limit: number
  shown: number
  total: number
}) {
  const next = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][],
  )
  next.set('limit', String(limit + PAGE_SIZE))
  return (
    <a
      href={`?${next}`}
      className="self-start text-[12.5px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
    >
      Afficher plus ({shown} sur {total})
    </a>
  )
}
