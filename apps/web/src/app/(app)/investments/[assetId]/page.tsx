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
import { OperationRows } from '@/components/investment-forms'
import { EmptyLine, PageBody, PageHeader, Section } from '@/components/page-shell'
import { StatRow, StatTile } from '@/components/stats'
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
  const { assetId } = await params
  const query = await searchParams
  const t = await getTranslations('investments')
  const format = await getFormat()

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
      />
      <PageBody>
        {position ? (
          <StatRow>
            <StatTile
              hero
              label={t('words.value')}
              value={position.value === null ? '—' : format.eur(position.value)}
              hint={`${format.number(position.quantity, 8)} × ${
                position.price === null ? '—' : format.eur(position.price, 2)
              }`}
              delta={gain === null ? undefined : { value: gain, label: t('detail.againstCost') }}
            />
            <StatTile
              label={t('detail.costBasis')}
              value={format.eur(position.costBasis)}
              hint={t('detail.costBasisHint', { amount: format.eur(position.averageCost, 2) })}
            />
          </StatRow>
        ) : (
          <EmptyLine>
            {history.length > 0
              ? t('detail.watchedLastPrice', { price: format.eur(history[history.length - 1]!.price, 2) })
              : t('detail.watchedNoPrice')}
          </EmptyLine>
        )}

        {history.length > 1 && (
          <Section
            title={t('words.price')}
            description={t('detail.sessions', { count: shown.length })}
            action={<WindowTabs />}
          >
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
          </Section>
        )}

        <Section title={t('words.operations')} description={t('detail.onThisAsset')}>
          {mine.length === 0 ? (
            <EmptyLine>{t('detail.noOperation')}</EmptyLine>
          ) : (
            <OperationRows
              sorter={operationSort}
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
          )}
        </Section>

        {gain !== null && (
          <p className="text-[11.5px] text-faint">
            {t('detail.unrealizedNote', { gain: format.eurSigned(gain, 2) })}
          </p>
        )}
      </PageBody>
    </>
  )
}
