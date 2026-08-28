import { auth } from '@abacus/core/auth'
import type { Position } from '@abacus/core/domain'
import { today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import {
  assetPrices,
  DEFAULT_OPERATION_SORT,
  DEFAULT_POSITION_SORT,
  firstOperationOn,
  listAssets,
  listOperations,
  OPERATION_SORTS,
  POSITION_SORTS,
  type PositionMass,
  portfolio,
  refreshQuotes,
  valuation,
} from '@abacus/core/services/investments'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BalanceChart } from '@/components/balance-chart'
import { EntrySheet } from '@/components/entry-sheet'
import {
  type AssetEntry,
  AssetMenu,
  AssetRows,
  FollowForm,
  OperationForm,
  OperationRows,
} from '@/components/investment-forms'
import { MassFold } from '@/components/mass-fold'
import { EmptyLine, PageBody, PageHeader, RowArrow, Rows, Section } from '@/components/page-shell'
import { SortColumn } from '@/components/sort'
import { StatRow, StatTile } from '@/components/stats'
import { UrlTabs } from '@/components/url-tabs'
import { WindowTabs } from '@/components/window-tabs'
import { resolveChartWindow } from '@/lib/chart-window'
import { sorter } from '@/lib/sort'
import { eur, eurSigned, frDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Placements' }

/** How much of the journal the page shows at once. */
const OPERATION_PAGE = 30

/** Quantities are not money: they keep their own precision, trailing zeros cut. */
function quantity(value: string): string {
  return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 8 })
}

/**
 * When the price was made, to the minute. Euronext is 15 minutes delayed at
 * best, imposed by its licence, so freshness cannot be gained: it is declared
 * instead, and a number without its hour would be read as "now".
 */
function priceStamp(at: Date | null, manual: boolean): string | null {
  if (!at) return null
  const day = at.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
  if (manual) return `saisi le ${day}`
  // Bare day and hour: it sits under the name, beside the Cours column, so the
  // word "cours" would only cost the room the hour needs.
  return `${day} ${at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * One holding: what it is, how much of it, what it is worth. The average cost
 * and the hour of its price ride under the name, so the two numbers one comes
 * for (its value, what it made) are the ones that always fit.
 */
function PositionRow({ position }: { position: Position }) {
  const stamp = priceStamp(position.pricedAt, position.manualPrice)
  const gain = position.gain === null ? null : Number(position.gain)
  return (
    <div className="group flex items-center gap-3 py-2">
      <Link
        href={`/investments/${position.assetId}?from=investments`}
        className="flex min-w-0 flex-1 flex-col gap-0.5"
      >
        <span className="truncate text-[12.5px] group-hover:text-primary">{position.assetName}</span>
        <span className="truncate text-[11px] text-faint">
          PRU {eur(Number(position.averageCost), 2)}
          {stamp ? ` · ${stamp}` : ' · aucun cours connu'}
        </span>
      </Link>
      <span className="tabular w-14 text-right text-[12.5px]">{quantity(position.quantity)}</span>
      <span className="tabular w-[4.5rem] text-right text-[12.5px] text-muted-foreground">
        {position.price === null ? '—' : eur(Number(position.price), 2)}
      </span>
      <span className="tabular w-[5.5rem] text-right text-[12.5px]">
        {position.value === null ? '—' : eur(Number(position.value), 2)}
      </span>
      <span className={`tabular w-[5.5rem] text-right text-[12.5px] ${gainInk(gain)}`}>
        {/* The arrow carries the direction; color reinforces it. */}
        {gain === null ? '—' : `${gain >= 0 ? '↑' : '↓'} ${eurSigned(gain, 2)}`}
      </span>
      <RowArrow />
      <AssetMenu id={position.assetId} name={position.assetName} />
    </div>
  )
}

function gainInk(gain: number | null): string {
  return gain === null ? 'text-faint' : gain >= 0 ? 'text-good' : 'text-destructive'
}

/**
 * A mass's own numbers, in the columns its lines use: the two that add up.
 * Quantities do not (three shares and two coins are not five of anything) and
 * neither does a price, so those two columns stay empty rather than answer
 * something false.
 */
function MassFigures({ mass }: { mass: PositionMass }) {
  const gain = mass.gain === null ? null : Number(mass.gain)
  // Nothing here has a price: a zero would read as "this mass is worth
  // nothing", where the header's note says what is actually the case.
  const blind = mass.unpriced === mass.positions.length
  return (
    <>
      <span className="w-14" />
      <span className="w-[4.5rem]" />
      <span className="tabular w-[5.5rem] text-right text-[12.5px] font-semibold">
        {blind ? '—' : eur(Number(mass.value), 2)}
      </span>
      <span className={`tabular w-[5.5rem] text-right text-[12.5px] font-semibold ${gainInk(gain)}`}>
        {gain === null ? '—' : `${gain >= 0 ? '↑' : '↓'} ${eurSigned(gain, 2)}`}
      </span>
      <span className="w-11" />
    </>
  )
}

export default async function InvestmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id

  // Prices come from the read, never from a scheduler: whoever opens this page
  // gets them as fresh as the sources allow. It never throws, and a source that
  // is down leaves the stored price in place.
  await refreshQuotes(userId)

  const now = today()
  const params = await searchParams
  const reading = params.chart === 'performance' ? 'performance' : 'value'
  // Two lists on the page, two orders: each writes its own parameter, so
  // ranking the holdings never reshuffles the journal under them.
  const positionSort = sorter('positions', POSITION_SORTS, DEFAULT_POSITION_SORT, params)
  const operationSort = sorter('operations', OPERATION_SORTS, DEFAULT_OPERATION_SORT, params)
  // The oldest operation is where the curve can start at all. Asked for on its
  // own, because the journal below is ordered and cut: its last row is the
  // last of thirty, not the first one ever declared.
  const firstOperation = await firstOperationOn(userId)
  const from = firstOperation ? resolveChartWindow(params, now, firstOperation).from : now
  const [accounts, held, assets, quotes, series, operations] = await Promise.all([
    listAccounts(userId),
    portfolio(userId, positionSort.current),
    listAssets(userId),
    assetPrices(userId),
    firstOperation ? valuation(userId, from, now) : Promise.resolve([]),
    listOperations(userId, { sort: operationSort.current, limit: OPERATION_PAGE }),
  ])
  const investmentAccounts = accounts.filter((a) => a.behavior === 'investment' && !a.closedOn)
  const assetNames = new Map(assets.map((a) => [a.id, a.name]))
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]))

  const value = held.reduce((sum, h) => sum + Number(h.value), 0)
  const cash = held.reduce((sum, h) => sum + Number(h.cash), 0)
  const costBasis = held.reduce((sum, h) => sum + Number(h.costBasis), 0)
  const unpriced = held.reduce((sum, h) => sum + h.unpriced, 0)
  const positionCount = held.reduce((sum, h) => sum + h.positions.length, 0)
  // Only whole when every position has a price: a partial one would understate
  // the account, which is worse than saying nothing.
  const complete = held.every((h) => h.totalReturn !== null)
  const totalReturn = complete ? held.reduce((sum, h) => sum + Number(h.totalReturn), 0) : null
  const contributions = held.reduce((sum, h) => sum + Number(h.netContributions), 0)
  const unrealized = value - cash - costBasis

  // Followed, not held: an asset with no position is one being watched. That is
  // the whole mechanism, and it needs no flag of its own.
  const holdingIds = new Set(held.flatMap((h) => h.positions.map((p) => p.assetId)))
  const assetEntries: AssetEntry[] = assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    pricing: asset.instrument ? `${asset.instrument.priceSource} · ${asset.instrument.priceSourceRef}` : null,
    isin: asset.instrument?.isin ?? null,
    followed: !holdingIds.has(asset.id),
    nature: asset.nature,
  }))
  const followed = assetEntries
    .filter((a) => a.followed)
    .map((a) => ({ ...a, price: quotes.get(a.id) ?? null }))

  const entry = (
    <>
      <EntrySheet
        label="Suivre"
        title="Suivre un actif"
        description="Sans le détenir : son cours s’affichera, et le jour où tu en achètes il devient une position."
        variant="outline"
      >
        <FollowForm />
      </EntrySheet>
      <EntrySheet
        label="Déclarer une opération"
        title="Opération"
        description="Ce qui se passe dans le compte. Alimenter le compte ou en sortir de l’argent est un virement, à déclarer dans les mouvements."
      >
        <OperationForm
          accounts={investmentAccounts.map((a) => ({ id: a.id, name: a.name }))}
          assets={assetEntries}
          today={now}
        />
      </EntrySheet>
    </>
  )

  return (
    <>
      <PageHeader title="Placements" description="ce que tu détiens, et ce que ça vaut">
        {investmentAccounts.length > 0 && entry}
      </PageHeader>

      <PageBody>
        {investmentAccounts.length === 0 ? (
          <EmptyLine>
            Aucun compte d’investissement. Crée-le dans{' '}
            <Link href="/accounts" className="text-primary hover:underline">
              Comptes
            </Link>
            , puis déclare ici ce que tu y détiens.
          </EmptyLine>
        ) : firstOperation === null && assets.length === 0 ? (
          // One line, and the two panels the header already carries: a title, a
          // description and a sentence all saying "nothing yet" said it thrice.
          <EmptyLine>
            Déclare ton premier achat : le panneau cherche l’ETF, l’action ou la crypto par son nom, son ISIN
            ou son fournisseur.
          </EmptyLine>
        ) : (
          <>
            <StatRow>
              <StatTile
                hero
                label="Valorisation"
                value={eur(value)}
                hint={
                  unpriced > 0
                    ? `espèces + positions cotées ; ${unpriced} sans cours`
                    : 'espèces + positions au dernier cours'
                }
                delta={positionCount > 0 ? { value: unrealized, label: 'de plus-value latente' } : undefined}
              />
              <StatTile
                label="Performance"
                value={totalReturn === null ? '—' : eurSigned(totalReturn)}
                // The method is the number: what it includes, and what it is
                // measured against. Naming the contributions is what makes it
                // checkable by hand.
                hint={
                  totalReturn === null
                    ? 'un cours manque : le calcul serait sous-estimé'
                    : `dividendes et frais compris, contre ${eur(contributions)} d’apports`
                }
              />
            </StatRow>

            {series.some((p) => Number(p.holdings) > 0) && (
              <Section
                // The selected tab names the reading, so the title does not
                // repeat it: "Performance" as a title, as an active tab and as
                // a tile above said one thing three times.
                title="Évolution"
                description={
                  reading === 'performance'
                    ? `valorisation − apports, depuis le ${frDate(from)}`
                    : `contre les apports, depuis le ${frDate(from)}`
                }
                action={
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <WindowTabs />
                    <UrlTabs
                      param="chart"
                      fallback="value"
                      ariaLabel="Lecture du graphe"
                      options={[
                        { value: 'value', label: 'Valorisation' },
                        { value: 'performance', label: 'Performance' },
                      ]}
                    />
                  </div>
                }
              >
                {reading === 'performance' ? (
                  // The contributions laid flat. Drawn this way the curve does
                  // not jump when money comes in (both series rise by the same
                  // amount), so every move it makes is one the market made.
                  <BalanceChart
                    lines={[{ id: 'performance', name: 'Performance' }]}
                    rows={series.map((point) => ({
                      day: point.day,
                      lineId: 'performance',
                      balance: Number(point.cash) + Number(point.holdings) - Number(point.contributions),
                    }))}
                    today={now}
                    baseline={{ value: 0, name: 'Apports' }}
                    ariaLabel="Performance des placements contre les apports"
                  />
                ) : (
                  <BalanceChart
                    lines={[
                      { id: 'value', name: 'Valorisation' },
                      { id: 'contributions', name: 'Apports' },
                    ]}
                    rows={series.flatMap((point) => [
                      {
                        day: point.day,
                        lineId: 'value',
                        balance: Number(point.cash) + Number(point.holdings),
                      },
                      { day: point.day, lineId: 'contributions', balance: Number(point.contributions) },
                    ])}
                    today={now}
                    ariaLabel="Valorisation des placements et apports"
                  />
                )}
              </Section>
            )}

            {held.map(({ account, positions, masses, cash: accountCash, value: accountValue }) => (
              <Section
                key={account.id}
                title={account.name}
                description={`${eur(Number(accountValue), 2)} · ${
                  Number(accountCash) < 0
                    ? `${eur(-Number(accountCash), 2)} à alimenter`
                    : `${eur(Number(accountCash), 2)} en espèces`
                }`}
              >
                {positions.length === 0 ? (
                  <EmptyLine>Aucune position : rien n’a encore été acheté sur ce compte.</EmptyLine>
                ) : (
                  <div className="overflow-x-auto">
                    {/* Five columns, not six: the average cost and the hour of
                        the price ride under the name, so the two numbers being
                        looked for (what it is worth, what it made) are the ones
                        that always fit. */}
                    <Rows className="min-w-[30rem]">
                      <div className="flex items-center gap-3 py-1.5 text-[11px] text-faint">
                        <SortColumn
                          sorter={positionSort}
                          field="name"
                          label="Actif"
                          className="min-w-0 flex-1"
                        />
                        <SortColumn
                          sorter={positionSort}
                          field="quantity"
                          label="Quantité"
                          align="right"
                          className="w-14 shrink-0"
                        />
                        <SortColumn
                          sorter={positionSort}
                          field="price"
                          label="Cours"
                          align="right"
                          className="w-[4.5rem] shrink-0"
                        />
                        <SortColumn
                          sorter={positionSort}
                          field="value"
                          label="Valorisation"
                          align="right"
                          className="w-[5.5rem] shrink-0"
                        />
                        <SortColumn
                          sorter={positionSort}
                          field="gain"
                          label="+/− value"
                          align="right"
                          className="w-[5.5rem] shrink-0"
                        />
                        <span className="w-11" />
                      </div>
                      {/* A single mass carries no header: its total is the
                          account's, which the section already states. */}
                      {masses.length === 1
                        ? positions.map((position) => (
                            <PositionRow key={position.assetId} position={position} />
                          ))
                        : masses.map((mass) => (
                            <MassFold
                              key={mass.nature}
                              nature={mass.nature}
                              note={
                                mass.unpriced > 0
                                  ? `${mass.unpriced} sans cours, non valorisée${mass.unpriced > 1 ? 's' : ''}`
                                  : undefined
                              }
                              figures={<MassFigures mass={mass} />}
                            >
                              {mass.positions.map((position) => (
                                <PositionRow key={position.assetId} position={position} />
                              ))}
                            </MassFold>
                          ))}
                    </Rows>
                  </div>
                )}
              </Section>
            ))}

            {followed.length > 0 && (
              <Section title="Suivis" description="pas encore détenus">
                <AssetRows assets={followed} />
              </Section>
            )}

            <Section
              title="Opérations"
              // What the slice holds depends on the order it was cut in, so it
              // is named rather than left to be assumed.
              description={
                operationSort.current.field === 'date' && operationSort.current.direction === 'desc'
                  ? `les ${OPERATION_PAGE} dernières`
                  : `${OPERATION_PAGE} au plus, dans cet ordre`
              }
            >
              {operations.length === 0 ? (
                <EmptyLine>Rien de déclaré pour l’instant.</EmptyLine>
              ) : (
                <OperationRows
                  sorter={operationSort}
                  operations={operations.map((operation) => ({
                    id: operation.id,
                    type: operation.type,
                    operatedOn: operation.operatedOn,
                    quantity: operation.quantity,
                    amount: operation.amount,
                    note: operation.note,
                    accountId: operation.accountId,
                    accountName: accountNames.get(operation.accountId) ?? '',
                    assetName: operation.assetId ? (assetNames.get(operation.assetId) ?? null) : null,
                  }))}
                  accounts={investmentAccounts.map((a) => ({ id: a.id, name: a.name }))}
                />
              )}
            </Section>
          </>
        )}
      </PageBody>
    </>
  )
}
