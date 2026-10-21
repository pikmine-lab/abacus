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
import { getTranslations } from 'next-intl/server'
import { BalanceChart } from '@/components/balance-chart'
import { Block, Figure, FigureRow } from '@/components/composition'
import { BAND } from '@/components/expense-list'
import { HandPriceEntry, OperationRows } from '@/components/investment-forms'
import { PageBody, PageHeader } from '@/components/page-shell'
import { WindowTabs } from '@/components/window-tabs'
import { resolveChartWindow } from '@/lib/chart-window'
import { getFormat } from '@/lib/format-server'
import { sorter } from '@/lib/sort'

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
  const t = await getTranslations('investments')
  const format = await getFormat()
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
          [asset.instrument?.isin, asset.instrument?.priceSourceRef ?? t('words.manualPrice')]
            .filter(Boolean)
            .join(' · ') || undefined
        }
      >
        {/* Only what no source quotes takes a price by hand: a quoted one has its answer. */}
        {!asset.instrumentId && <HandPriceEntry assetId={asset.id} name={asset.name} today={today()} />}
      </PageHeader>
      <PageBody className="@container gap-10">
        {/* The figure that dominates beside what explains it: a holding's worth
            moves with its price, drawn next to it. */}
        <div className={BAND}>
          {position ? (
            <div className="flex min-w-0 flex-col gap-4">
              <Figure
                hero
                label={t('words.value')}
                value={position.value === null ? null : Number(position.value)}
                // The limit of the gain is said with it: dividends and fees went
                // through the account's cash, not through this line.
                delta={gain === null ? undefined : { value: gain, label: t('detail.unrealized') }}
                note={`${format.number(position.quantity, 8)} × ${
                  position.price === null ? '—' : format.eur(position.price, 2)
                }`}
              />
              <FigureRow compact>
                <Figure
                  compact
                  label={t('detail.costBasis')}
                  value={Number(position.costBasis)}
                  note={t('detail.costBasisHint', { amount: format.eur(position.averageCost, 2) })}
                />
              </FigureRow>
            </div>
          ) : (
            // Followed, not held: what is read is its price.
            <Figure
              hero
              label={t('words.price')}
              value={lastPrice}
              decimals={2}
              note={lastPrice === null ? t('detail.watchedNoPrice') : t('detail.watched')}
            />
          )}
          {history.length > 1 && (
            <section aria-label={t('words.price')} className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <h2 className="text-[13px] font-medium text-muted-foreground">{t('words.price')}</h2>
                <span className="text-[11.5px] text-faint">
                  {t('detail.sessions', { count: shown.length })}
                </span>
                <div className="ml-auto">
                  <WindowTabs />
                </div>
              </div>
              <BalanceChart
                lines={[{ id: 'price', name: t('words.price') }]}
                rows={shown.map((point) => ({
                  day: point.quotedOn,
                  lineId: 'price',
                  balance: Number(point.price),
                }))}
                today={today()}
                // A price is not read against zero: forcing it in draws a share
                // at 709 € as a flat line and hides the very move being looked at.
                zeroBased={false}
                ariaLabel={t('detail.priceAria', { name: asset.name })}
              />
            </section>
          )}
        </div>

        {/* A followed asset has none, which its figure already says. */}
        {mine.length > 0 && (
          <Block label={t('words.operations')} className="gap-2">
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
