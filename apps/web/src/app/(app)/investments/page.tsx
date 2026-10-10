import { auth } from '@abacus/core/auth'
import { today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import { listActivities } from '@abacus/core/services/catalog'
import {
  COMMITMENT_SORTS,
  DEFAULT_COMMITMENT_SORT,
  listCommitmentsWithProgress,
  monthlyEquivalentEur,
  pendingOccurrences,
  sortCommitments,
} from '@abacus/core/services/commitments'
import {
  assetPrices,
  DEFAULT_OPERATION_SORT,
  DEFAULT_POSITION_SORT,
  firstOperationOn,
  holdingsByNature,
  listAssets,
  listOperations,
  OPERATION_SORTS,
  POSITION_SORTS,
  portfolio,
  refreshQuotes,
  valuation,
} from '@abacus/core/services/investments'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { BalanceChart } from '@/components/balance-chart'
import { CommitmentRow } from '@/components/commitment-blocks'
import { ActionCard, Block, Figure, FigureRow } from '@/components/composition'
import { EntryDock } from '@/components/entry-dock'
import { EntryMenu, EntrySheet } from '@/components/entry-sheet'
import { BAND } from '@/components/expense-list'
import { FoldSection } from '@/components/fold-section'
import {
  type AssetEntry,
  AssetRows,
  FollowForm,
  OperationForm,
  OperationRows,
} from '@/components/investment-forms'
import { InvestmentPlanForm, type PlacementOptions } from '@/components/investment-plan-forms'
import { MassFocus } from '@/components/mass-strip'
import { EmptyLine, PageBody, PageHeader, Rows } from '@/components/page-shell'
import { PendingOccurrences } from '@/components/pending-occurrences'
import { PositionList } from '@/components/position-list'
import { SortMenu } from '@/components/sort'
import { UrlTabs } from '@/components/url-tabs'
import { WindowTabs } from '@/components/window-tabs'
import { resolveChartWindow } from '@/lib/chart-window'
import { getFormat } from '@/lib/format-server'
import { sorter } from '@/lib/sort'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getTranslations('investments')
  return { title: t('title') }
}

const PATH = '/investments'

/** How much of the journal the page shows at once. */
const OPERATION_PAGE = 30

export default async function InvestmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const t = await getTranslations('investments')
  const format = await getFormat()

  // Prices come from the read, never from a scheduler: whoever opens this page
  // gets them as fresh as the sources allow. It never throws, and a source that
  // is down leaves the stored price in place.
  await refreshQuotes(userId)

  const now = today()
  const params = await searchParams
  // The chart opens on what the placements made: their worth is the figure beside it.
  const reading = params.chart === 'value' ? 'value' : 'performance'
  // Three lists on the page, three orders: each writes its own parameter, so
  // ranking the holdings never reshuffles the journal under them.
  const positionSort = sorter('positions', POSITION_SORTS, DEFAULT_POSITION_SORT, params)
  const operationSort = sorter('operations', OPERATION_SORTS, DEFAULT_OPERATION_SORT, params)
  const planSort = sorter('plans', COMMITMENT_SORTS, DEFAULT_COMMITMENT_SORT, params)
  // The oldest operation is where the curve can start at all. Asked for on its
  // own, because the journal below is ordered and cut: its last row is the
  // last of thirty, not the first one ever declared.
  const firstOperation = await firstOperationOn(userId)
  const from = firstOperation ? resolveChartWindow(params, now, firstOperation).from : now
  const [accounts, held, assets, quotes, series, operations, commitments, pending, activities] =
    await Promise.all([
      listAccounts(userId),
      portfolio(userId, positionSort.current),
      listAssets(userId),
      assetPrices(userId),
      firstOperation ? valuation(userId, from, now) : Promise.resolve([]),
      listOperations(userId, { sort: operationSort.current, limit: OPERATION_PAGE }),
      // Cancelled ones left out: a stopped placement is history, and this page
      // is read for what is running.
      listCommitmentsWithProgress(userId, true),
      pendingOccurrences(userId),
      listActivities(userId),
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
  // The split is read across accounts; a line names its account only when
  // more than one holds something, since otherwise every line would say the same.
  const masses = holdingsByNature(held, positionSort.current)
  const holdingAccounts = held.filter((h) => h.positions.length > 0).length

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

  // Scheduled placements: declared once here, and each occurrence confirmed
  // here too, because that confirmation buys.
  const plans = commitments.filter((c) => c.kind === 'investment_plan')
  const monthlyInvested = plans.reduce((sum, c) => sum + monthlyEquivalentEur(c), 0)
  const pendingPlacements = pending.filter((p) => p.placement !== null)
  const placementOptions: PlacementOptions = {
    accounts: accounts.filter((a) => !a.closedOn).map((a) => ({ id: a.id, name: a.name })),
    investmentAccounts: investmentAccounts.map((a) => ({ id: a.id, name: a.name })),
    assets: assetEntries,
    activities: activities.map((a) => ({ id: a.id, name: a.name })),
  }
  // The row's shared correction panel reads its references from here; a
  // placement carries no actor and no category, so those lists stay empty.
  const commitmentOptions = {
    accounts: placementOptions.accounts,
    actors: [],
    categories: [],
    activities: placementOptions.activities,
  }

  // The two rarer entries, declared once: written out beside the frequent one
  // on a wide screen, gathered behind one menu on a phone, where the header
  // has room for a single named button.
  const followEntry = {
    label: t('page.follow.title'),
    title: t('page.follow.title'),
    description: t('page.follow.description'),
    content: <FollowForm />,
  }
  const planEntry = {
    label: t('page.plan.label'),
    title: t('page.plan.title'),
    description: t('page.plan.description'),
    content: <InvestmentPlanForm options={placementOptions} today={now} />,
  }
  const entry = (
    <>
      <div className="contents max-sm:hidden">
        <EntrySheet
          label={t('page.follow.label')}
          title={followEntry.title}
          description={followEntry.description}
          variant="outline"
        >
          {followEntry.content}
        </EntrySheet>
        <EntrySheet
          label={planEntry.label}
          title={planEntry.title}
          description={planEntry.description}
          variant="outline"
        >
          {planEntry.content}
        </EntrySheet>
      </div>
      <div className="contents sm:hidden">
        <EntryMenu label={t('page.otherEntries')} entries={[followEntry, planEntry]} />
      </div>
      <EntrySheet
        label={t('page.operation.label')}
        short={t('page.operation.short')}
        title={t('page.operation.title')}
        description={t('page.operation.description')}
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
    // Operations are declared in bursts: the panel docks beside the page, so
    // each one sent lands in a journal that stays readable next to it.
    <EntryDock>
      <PageHeader title={t('title')}>{investmentAccounts.length > 0 && entry}</PageHeader>

      {/* One container for the band and the list, so the list's figures line up under its split. */}
      <PageBody className="@container gap-10">
        {investmentAccounts.length === 0 ? (
          <EmptyLine>
            {t.rich('page.noAccount', {
              link: (chunks) => (
                <Link href="/accounts" className="text-primary hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </EmptyLine>
        ) : firstOperation === null && assets.length === 0 && plans.length === 0 ? (
          // One line, and the panels the header already carries: a title, a
          // description and a sentence all saying "nothing yet" said it thrice.
          <EmptyLine>{t('page.firstBuy')}</EmptyLine>
        ) : (
          <>
            {/* The figure that dominates with what it rests on under it, beside
                what waits on the user: the placements that fell. */}
            <div className={BAND}>
              <div className="flex min-w-0 flex-col gap-4">
                <Figure
                  hero
                  label={t('words.value')}
                  value={value}
                  delta={positionCount > 0 ? { value: unrealized, label: t('page.unrealized') } : undefined}
                  note={unpriced > 0 ? t('page.valueHintUnpriced', { count: unpriced }) : t('page.valueHint')}
                />
                <FigureRow compact>
                  <Figure
                    compact
                    signed
                    label={t('words.performance')}
                    value={totalReturn}
                    // The method is the number: what it includes, and what it is
                    // measured against. Naming the contributions is what makes it
                    // checkable by hand.
                    note={
                      totalReturn === null
                        ? t('page.performanceMissing')
                        : t('page.performanceHint', { amount: format.eur(contributions) })
                    }
                  />
                  {/* Counted apart, never beside the committed costs: this money
                      stays the user's, it only changes form. */}
                  {plans.length > 0 && (
                    <Figure
                      compact
                      label={t('page.scheduled')}
                      value={monthlyInvested}
                      per={t('page.perMonth')}
                      note={t('page.scheduledYearly', { amount: format.eur(monthlyInvested * 12) })}
                    />
                  )}
                </FigureRow>
              </div>
              {/* An occurrence waiting to be confirmed is work to do: it never
                  waits behind the plans' fold. Beside the figure, the card never
                  runs longer than it and scrolls within; stacked, it takes the
                  room it needs. */}
              {pendingPlacements.length > 0 && (
                <div className="relative min-h-0">
                  <div className="flex flex-col @4xl:absolute @4xl:inset-x-0 @4xl:top-0 @4xl:max-h-full">
                    <ActionCard label={t('page.toConfirm')} scrolls>
                      <PendingOccurrences
                        back={PATH}
                        aheadInPanel
                        items={pendingPlacements.map((p) => ({
                          commitmentId: p.commitment.id,
                          label: p.commitment.label,
                          dueOn: p.dueOn,
                          periodUnit: p.commitment.periodUnit,
                          ahead: p.ahead,
                          amount: p.amount,
                          currency: p.commitment.currency,
                          incoming: false,
                          account: accountNames.get(p.accountId) ?? '',
                          placement: {
                            targetAccount: accountNames.get(p.placement!.targetAccountId) ?? '',
                            asset: assetNames.get(p.placement!.assetId) ?? '',
                          },
                        }))}
                      />
                    </ActionCard>
                  </div>
                </div>
              )}
            </div>

            {series.some((p) => Number(p.holdings) > 0) && (
              // The selected reading names the block: a title over a tab saying
              // the same word said it twice.
              <section aria-label={t('page.evolution.title')} className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <UrlTabs
                    param="chart"
                    fallback="performance"
                    ariaLabel={t('page.evolution.readingLabel')}
                    options={[
                      { value: 'performance', label: t('words.performance') },
                      { value: 'value', label: t('words.value') },
                    ]}
                  />
                  <div className="ml-auto">
                    <WindowTabs />
                  </div>
                </div>
                {reading === 'performance' ? (
                  // The contributions laid flat. Drawn this way the curve does
                  // not jump when money comes in (both series rise by the same
                  // amount), so every move it makes is one the market made.
                  <BalanceChart
                    lines={[{ id: 'performance', name: t('words.performance') }]}
                    rows={series.map((point) => ({
                      day: point.day,
                      lineId: 'performance',
                      balance: Number(point.cash) + Number(point.holdings) - Number(point.contributions),
                    }))}
                    today={now}
                    baseline={{ value: 0, name: t('words.contributions') }}
                    ariaLabel={t('page.evolution.performanceAria')}
                  />
                ) : (
                  <BalanceChart
                    lines={[
                      { id: 'value', name: t('words.value') },
                      { id: 'contributions', name: t('words.contributions') },
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
                    ariaLabel={t('page.evolution.valueAria')}
                  />
                )}
              </section>
            )}

            {positionCount > 0 && (
              <MassFocus>
                <PositionList masses={masses} sorter={positionSort} showAccount={holdingAccounts > 1} />
              </MassFocus>
            )}

            {/* The accounts keep what the masses cannot say: their own worth,
                and the cash beside the holdings. */}
            <Block label={t('page.accounts')}>
              <FigureRow compact>
                {held.map(({ account, positions, cash: accountCash, value: accountValue }) => (
                  <Figure
                    compact
                    key={account.id}
                    label={account.name}
                    value={Number(accountValue)}
                    note={
                      Number(accountCash) < 0
                        ? t('page.toFund', { cash: format.eur(-Number(accountCash), 2) })
                        : positions.length === 0
                          ? t('page.noPositionShort')
                          : t('page.inCash', { cash: format.eur(accountCash, 2) })
                    }
                  />
                ))}
              </FigureRow>
            </Block>

            {followed.length > 0 && (
              <Block label={t('page.followed.title')}>
                <AssetRows assets={followed} />
              </Block>
            )}

            {/* Declared once and reread rarely: folded, so it does not push
                down what the page is opened for. */}
            {plans.length > 0 && (
              <FoldSection
                title={t('page.plans.title')}
                description={t('page.plans.count', { count: plans.length })}
                action={
                  plans.length > 1 && (
                    <SortMenu
                      sorter={planSort}
                      options={[
                        { field: 'monthly', label: t('page.plans.sorts.monthly') },
                        { field: 'amount', label: t('page.plans.sorts.amount') },
                        { field: 'next', label: t('page.plans.sorts.next') },
                        { field: 'label', label: t('words.name') },
                      ]}
                    />
                  )
                }
              >
                <Rows>
                  {sortCommitments(plans, planSort.current).map((plan) => (
                    <CommitmentRow
                      key={plan.id}
                      commitment={plan}
                      showJudgment={false}
                      today={now}
                      options={commitmentOptions}
                      placement={{
                        options: placementOptions,
                        assetName: assetNames.get(plan.assetId ?? '') ?? '',
                      }}
                    />
                  ))}
                </Rows>
              </FoldSection>
            )}

            <Block
              label={t('words.operations')}
              className="gap-2"
              // What the slice holds depends on the order it was cut in, so it
              // is named rather than left to be assumed.
              qualifier={
                operationSort.current.field === 'date' && operationSort.current.direction === 'desc'
                  ? t('page.latest', { count: OPERATION_PAGE })
                  : t('page.atMost', { count: OPERATION_PAGE })
              }
            >
              {operations.length === 0 ? (
                <EmptyLine>{t('page.noOperation')}</EmptyLine>
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
            </Block>
          </>
        )}
      </PageBody>
    </EntryDock>
  )
}
