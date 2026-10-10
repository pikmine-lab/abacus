import { auth } from '@abacus/core/auth'
import { today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import {
  assetHistory,
  DEFAULT_OPERATION_SORT,
  listAssets,
  listOperations,
  OPERATION_SORTS,
  positions,
  refreshQuotes,
} from '@abacus/core/services/investments'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { BalanceChart } from '@/components/balance-chart'
import { Block, Figure, FigureRow } from '@/components/composition'
import { BAND } from '@/components/expense-list'
import { OperationRows } from '@/components/investment-forms'
import { PageBody, PageHeader } from '@/components/page-shell'
import { quantity } from '@/components/position-list'
import { WindowTabs } from '@/components/window-tabs'
import { resolveChartWindow } from '@/lib/chart-window'
import { sorter } from '@/lib/sort'
import { eur } from '@/lib/utils'

export const dynamic = 'force-dynamic'

/** One holding, and the two things one wants of it: its curve and its history. */
export default async function AssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ assetId: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const { assetId } = await params
  const query = await searchParams

  const assets = await listAssets(userId)
  const asset = assets.find((a) => a.id === assetId)
  // An id that designates nothing for this user is a 404, never someone else's
  // holding: the lookup is scoped to them before anything is read.
  if (!asset) notFound()

  const operationSort = sorter('operations', OPERATION_SORTS, DEFAULT_OPERATION_SORT, query)

  await refreshQuotes(userId)
  const [held, history, operations, accounts] = await Promise.all([
    positions(userId),
    assetHistory(userId, assetId),
    // Ordered whole, then narrowed to this asset: nothing is cut here, so the
    // order the SQL settled survives the filter.
    listOperations(userId, { sort: operationSort.current }),
    listAccounts(userId),
  ])
  const position = held.find((p) => p.assetId === assetId) ?? null
  const mine = operations.filter((o) => o.assetId === assetId)
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]))
  const gain = position?.gain === null || position === null ? null : Number(position.gain)
  const lastPrice = history.length > 0 ? Number(history[history.length - 1]!.price) : null
  // The window is cut here rather than in SQL: a year of closes is 256 points,
  // which the page already holds to say how many sessions are known.
  const from = history[0] ? resolveChartWindow(query, today(), history[0].quotedOn).from : null
  const shown = from === null ? [] : history.filter((point) => point.quotedOn >= from)

  return (
    <>
      <PageHeader
        title={asset.name}
        description={
          [asset.instrument?.isin, asset.instrument?.priceSourceRef ?? 'cours saisi à la main']
            .filter(Boolean)
            .join(' · ') || undefined
        }
      />
      <PageBody className="@container gap-10">
        {/* The figure that dominates beside what explains it: a holding's worth
            moves with its price, drawn next to it. */}
        <div className={BAND}>
          {position ? (
            <div className="flex min-w-0 flex-col gap-4">
              <Figure
                hero
                label="Valorisation"
                value={position.value === null ? null : Number(position.value)}
                // The limit of the gain is said with it: dividends and fees went
                // through the account's cash, not through this line.
                delta={
                  gain === null
                    ? undefined
                    : { value: gain, label: 'de plus-value latente, hors dividendes et frais' }
                }
                note={`${quantity(position.quantity)} × ${
                  position.price === null ? '—' : eur(Number(position.price), 2)
                }`}
              />
              <FigureRow compact>
                <Figure
                  compact
                  label="Prix de revient"
                  value={Number(position.costBasis)}
                  note={`PRU ${eur(Number(position.averageCost), 2)}, frais d’ordre compris`}
                />
              </FigureRow>
            </div>
          ) : (
            // Followed, not held: what is read is its price.
            <Figure
              hero
              label="Cours"
              value={lastPrice}
              decimals={2}
              note={lastPrice === null ? 'suivi, pas détenu ; aucun cours connu' : 'suivi, pas détenu'}
            />
          )}
          {history.length > 1 && (
            <section aria-label="Cours" className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <h2 className="text-[13px] font-medium text-muted-foreground">Cours</h2>
                <span className="text-[11.5px] text-faint">{shown.length} séances connues</span>
                <div className="ml-auto">
                  <WindowTabs />
                </div>
              </div>
              <BalanceChart
                lines={[{ id: 'price', name: 'Cours' }]}
                rows={shown.map((point) => ({
                  day: point.quotedOn,
                  lineId: 'price',
                  balance: Number(point.price),
                }))}
                today={today()}
                // A price is not read against zero: forcing it in draws a share
                // at 709 € as a flat line and hides the very move being looked at.
                zeroBased={false}
                ariaLabel={`Cours de ${asset.name}`}
              />
            </section>
          )}
        </div>

        {/* A followed asset has none, which its figure already says. */}
        {mine.length > 0 && (
          <Block label="Opérations" className="gap-2">
            <OperationRows
              sorter={operationSort}
              showAsset={false}
              split
              operations={mine.map((o) => ({
                id: o.id,
                type: o.type,
                operatedOn: o.operatedOn,
                quantity: o.quantity,
                amount: o.amount,
                note: o.note,
                accountId: o.accountId,
                accountName: accountNames.get(o.accountId) ?? '',
                assetName: asset.name,
              }))}
              accounts={accounts
                .filter((a) => a.behavior === 'investment')
                .map((a) => ({ id: a.id, name: a.name }))}
            />
          </Block>
        )}
      </PageBody>
    </>
  )
}
