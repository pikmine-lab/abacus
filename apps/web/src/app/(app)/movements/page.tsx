import { auth } from '@abacus/core/auth'
import type { MovementKind } from '@abacus/core/domain'
import { today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import { listActors } from '@abacus/core/services/actors'
import { listCards } from '@abacus/core/services/cards'
import { listActivities, listCategories } from '@abacus/core/services/catalog'
import { outstandingInvoices } from '@abacus/core/services/invoices'
import {
  DEFAULT_MOVEMENT_SORT,
  listMovements,
  MOVEMENT_SORTS,
  outstandingAdvances,
  selectionTotals,
} from '@abacus/core/services/movements'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ActionCard } from '@/components/composition'
import { EntryDock } from '@/components/entry-dock'
import { EntrySheet } from '@/components/entry-sheet'
import { MovementFilters } from '@/components/movement-filters'
import { MovementForm } from '@/components/movement-form'
import { MovementRowActions } from '@/components/movement-row-actions'
import { OutstandingAdvances } from '@/components/outstanding-advances'
import { PageBody } from '@/components/page-shell'
import { PeriodHeader } from '@/components/period-header'
import { SortButton, SortHead } from '@/components/sort'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { movementDraft, movementFormOptions } from '@/lib/movement-form-data'
import { resolvePeriod } from '@/lib/period'
import { currentReading } from '@/lib/reading'
import { sorter } from '@/lib/sort'
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
  const [accounts, actors, categories, activities, advances, openInvoices, cards] = await Promise.all([
    listAccounts(userId),
    listActors(userId),
    listCategories(userId),
    listActivities(userId),
    outstandingAdvances(userId),
    outstandingInvoices(userId),
    listCards(userId),
  ])
  const known = (id: string | undefined, among: { id: string }[]) =>
    id && among.some((entry) => entry.id === id) ? id : undefined

  // The order is part of the framing, like the period and the filters, and it
  // is settled in SQL: the list is cut at `limit`, so ordering what came back
  // would rank the page and pass it off as the ledger.
  const sort = sorter('sort', MOVEMENT_SORTS, DEFAULT_MOVEMENT_SORT, params)
  const reading = await currentReading(params, userId)

  const filters = {
    from: period.from,
    to: period.to,
    reading,
    kind: KINDS.includes(params.type as MovementKind) ? (params.type as MovementKind) : undefined,
    accountId: known(idParam(params.account), accounts),
    categoryId: known(idParam(params.category), categories),
    actorId: known(idParam(params.actor), actors),
    activityId: known(idParam(params.activity), activities),
    search: params.q,
    advancesOnly: params.advances === '1',
    sort: sort.current,
  }

  const [movements, selection] = await Promise.all([
    listMovements(userId, { ...filters, limit }),
    selectionTotals(userId, filters),
  ])

  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  const actorName = new Map(actors.map((a) => [a.id, a.name]))
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))
  const cardName = new Map(cards.map((c) => [c.id, c.name]))

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
  const options = movementFormOptions({ accounts, actors, categories, activities, cards })

  return (
    // Declaring is a burst: the panel docks beside the list, so each line
    // sent lands in a table that stays readable next to it.
    <EntryDock>
      <PeriodHeader
        title="Mouvements"
        period={period}
        reading={reading}
        actions={
          <EntrySheet label="Déclarer" title="Déclarer un mouvement">
            <MovementForm
              {...options}
              advances={openAdvances.map((a) => ({
                id: a.movementId,
                happenedOn: frDate(a.happenedOn),
                amount: a.expected,
                remaining: a.remaining,
              }))}
              invoices={openInvoices.map((i) => ({
                id: i.id,
                client: actorName.get(i.actorId) ?? '',
                label: `${i.reference ?? frDate(i.issuedOn)} · reste ${eur(Number(i.remainingAmount), 2)}`,
              }))}
              today={today()}
            />
          </EntrySheet>
        }
      >
        <MovementFilters
          accounts={options.accounts}
          categories={options.categories}
          actors={options.actors}
          activities={options.activities}
        />
      </PeriodHeader>

      <PageBody className="gap-6">
        {openAdvances.length > 0 && (
          <ActionCard label="À récupérer">
            <OutstandingAdvances advances={openAdvances} today={today()} back={PATH} />
          </ActionCard>
        )}

        <div className="flex flex-col gap-2">
          {/* Not on an empty selection: "0 mouvement" would say twice what the
              empty line says. */}
          {count > 0 && (
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
                  revenus{' '}
                  <span className="font-mono tabular text-muted-foreground">{eur(selection.income)}</span>
                </span>
              )}
              {Number(selection.transfer) > 0 && (
                <span className="text-faint">
                  virements{' '}
                  <span className="font-mono tabular text-muted-foreground">{eur(selection.transfer)}</span>
                </span>
              )}
            </div>
          )}

          {movements.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-faint">
              Rien ne correspond à cette sélection. Élargis la période ou efface les filtres.
            </p>
          ) : (
            // Columns follow the room the table has, not the screen: the docked
            // panel narrows it as much as a tablet does. What qualifies a line
            // then passes under its name rather than squeezing it, the date
            // last, on a phone (DESIGN.md § Composition).
            <div className="@container">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <SortHead
                      sorter={sort}
                      field="date"
                      label="Date"
                      className="hidden w-20 @md:table-cell"
                    />
                    <TableHead
                      aria-sort={
                        sort.current.field === 'counterparty'
                          ? sort.current.direction === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      {/* Without its column the date keeps its sort here, the
                          button announcing its own order. */}
                      {/* Joined to the name it now sits under, and first: the
                          name's chevron, reserved until hovered, then ends the
                          group instead of opening a gap that reads as a
                          column of its own. */}
                      <span className="flex items-center gap-1.5">
                        <SortButton sorter={sort} field="date" label="Date" className="@md:hidden" />
                        <span aria-hidden className="text-faint @md:hidden">
                          ·
                        </span>
                        <SortButton sorter={sort} field="counterparty" label="Contrepartie" />
                      </span>
                    </TableHead>
                    <SortHead
                      sorter={sort}
                      field="account"
                      label="Compte"
                      className="hidden @2xl:table-cell"
                    />
                    <SortHead
                      sorter={sort}
                      field="category"
                      label="Catégorie"
                      className="hidden @2xl:table-cell"
                    />
                    {/* Not sortable: the column only exists while the selection
                    holds a live claim, so an order resting on it would come
                    and go with the filters. */}
                    {owedInList && (
                      <TableHead className="hidden w-28 text-right @3xl:table-cell">À rembourser</TableHead>
                    )}
                    <SortHead sorter={sort} field="amount" label="Montant" className="w-28 text-right" />
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
                    const category = m.categoryId ? (categoryName.get(m.categoryId) ?? '') : ''
                    const card = m.cardId && (
                      <Link
                        href={`/accounts/cards/${m.cardId}?from=movements`}
                        className="text-[11px] text-faint transition-colors hover:text-primary"
                      >
                        carte {cardName.get(m.cardId) ?? ''}
                      </Link>
                    )
                    // What is still owed, which is not the same as "was an advance":
                    // a claim that came back in full has nothing left to announce.
                    const owed = stillOwed.get(m.id)
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="hidden font-mono text-[11.5px] text-faint @md:table-cell">
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
                          {/* The date above is the debit of the card's statement: the
                          expected one while it waits, in no balance until then. */}
                          {m.purchasedOn && (
                            <span
                              className="block text-[10.5px]"
                              title={
                                m.awaitingDebit
                                  ? 'Date d’achat. Prélèvement prévu à la date ci-dessus, relevé à valider'
                                  : 'Date d’achat, prélevé à la date ci-dessus'
                              }
                            >
                              achat {frDate(m.purchasedOn)}
                              {m.awaitingDebit && <span className="block">prévu</span>}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-0">
                          {/* A transfer wraps rather than lose its destination,
                              the fact that tells two transfers apart. */}
                          <span className={`block text-[13px] ${isTransfer ? 'break-words' : 'truncate'}`}>
                            {counterparty}
                          </span>
                          {/* The category before the account: it is what tells
                              two lines on the same account apart, and the end of
                              the line is what gets cut. */}
                          <span className="block truncate text-[11.5px] text-faint @2xl:hidden">
                            <span className="font-mono text-[11px] @md:hidden">
                              {frDate(m.happenedOn)} ·{' '}
                            </span>
                            {category && `${category} · `}
                            {account}
                            {card && <> · {card}</>}
                          </span>
                          {(m.accrualMonth || m.purchasedOn) && (
                            <span className="block truncate font-mono text-[10.5px] text-faint @md:hidden">
                              {m.accrualMonth && (
                                <span className="text-primary">→ {frMonth(m.accrualMonth)}</span>
                              )}
                              {m.accrualMonth && m.purchasedOn && ' · '}
                              {m.purchasedOn &&
                                `achat ${frDate(m.purchasedOn)}${m.awaitingDebit ? ', prévu' : ''}`}
                            </span>
                          )}
                          {m.note && <span className="block truncate text-[11px] text-faint">{m.note}</span>}
                        </TableCell>
                        <TableCell className="hidden text-[12px] text-muted-foreground @2xl:table-cell">
                          {account}
                          {card && <span className="block">{card}</span>}
                        </TableCell>
                        <TableCell className="hidden text-[12px] text-muted-foreground @2xl:table-cell">
                          {category}
                        </TableCell>
                        {owedInList && (
                          <TableCell className="hidden text-right @3xl:table-cell">
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
                          {/* Without its column, what is owed keeps a place by the
                              amount it is part of, never on the note's line. */}
                          {owed !== undefined && (
                            <span className="block font-sans text-[11px] font-normal text-primary @3xl:hidden">
                              {actorName.get(m.expectedRefundFromActorId!) ?? '?'} doit {eur(owed, 2)}
                            </span>
                          )}
                          {/* Under the amount, because that is what it qualifies:
                          this figure is in no total above and in no analysis. */}
                          {m.ghost && (
                            <span
                              className="block text-[11px] font-normal text-faint"
                              title="Compté dans les soldes, dans aucune analyse"
                            >
                              fantôme
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="pr-1 pl-0 text-right">
                          <MovementRowActions
                            {...options}
                            today={today()}
                            label={`${frDate(m.happenedOn)} · ${counterparty} · ${eur(Number(m.amount), 2)}`}
                            draft={movementDraft(m, actorName)}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {count > movements.length && (
            <MoreLink params={params} limit={limit} shown={movements.length} total={count} />
          )}
        </div>
      </PageBody>
    </EntryDock>
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
