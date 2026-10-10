import { auth } from '@abacus/core/auth'
import { today } from '@abacus/core/domain/period'
import { rankingViewPreference } from '@abacus/core/services/preferences'
import type { BreakdownMass, BreakdownRow, FlowKind } from '@abacus/core/services/reports'
import {
  firstDeclaredDay,
  flowTotals,
  monthlyFlows,
  spendingBreakdown,
  spendingByCategoryGroup,
} from '@abacus/core/services/reports'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { BreakdownBars } from '@/components/breakdown-bars'
import { Figure, FigureRow } from '@/components/composition'
import { FlowChart } from '@/components/flow-chart'
import { MoneyMap } from '@/components/money-map'
import { PageBody } from '@/components/page-shell'
import { PeriodHeader } from '@/components/period-header'
import { ShareRanking } from '@/components/share-strip'
import { UrlTabs } from '@/components/url-tabs'
import { BarsIcon, MapIcon, StripIcon } from '@/components/view-icons'
import { flowBandWindow } from '@/lib/flow-band'
import { getFormat } from '@/lib/format-server'
import { FOCUS_PARAM, VIEW_PARAM } from '@/lib/money-map'
import { moneyMap } from '@/lib/money-map-tree'
import { paceMonths } from '@/lib/pace'
import { previousWindow, readingQualifier, resolvePeriod } from '@/lib/period'
import { currentReading } from '@/lib/reading'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getTranslations('shell.screens')
  return { title: t('analysis') }
}

/**
 * The dimensions ranked here. The category group leads, and is the default: it
 * answers "where does the money go" in a handful of masses, then unfolds into
 * the categories it merges, which carry the link to the movements. It has no
 * entity of its own, which is why it unfolds instead of linking.
 */
const GROUPS = ['categoryGroup', 'category', 'actor', 'activity'] as const
type Ranked = (typeof GROUPS)[number]
const DEFAULT_GROUP: Ranked = 'categoryGroup'

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string
    ref?: string
    by?: string
    flow?: string
    reading?: string
    view?: string
    split?: string
  }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const now = today()
  const params = await searchParams
  const [t, screens, mapWords, unset, words, periodWords, format] = await Promise.all([
    getTranslations('analysis'),
    getTranslations('shell.screens'),
    getTranslations('analysis.map'),
    getTranslations('analysis.unset'),
    getTranslations('analysis.words'),
    getTranslations('common.period'),
    getFormat(),
  ])
  const periodContext = { t: periodWords, format }
  const period = resolvePeriod(periodContext, params, now)
  const previous = previousWindow(periodContext, period)
  const reading = await currentReading(params, userId)
  // Every flow figure says when the accrual reading is in force, as on the
  // overview; the band above them also names the whole months it covers.
  const flowQualifier = reading === 'accrual' ? periodWords('accrual') : undefined
  const bandQualifier = readingQualifier(periodContext, period, reading)

  const groupBy = (GROUPS as readonly string[]).includes(params.by ?? '')
    ? (params.by as Ranked)
    : DEFAULT_GROUP
  const kind: FlowKind = params.flow === 'income' ? 'income' : 'expense'
  // The map is another reading of the same money, opened for a visit: it
  // lives in the URL with its zoom, unlike the way the ranking is drawn.
  const map = params.view === 'map'
  const split = params.split === 'activity'

  const firstDay = await firstDeclaredDay(userId)
  const band = flowBandWindow(period, firstDay, now.slice(0, 7))
  // A group comes back with the categories it merges, the other dimensions
  // with a flat row: one type covering both, so the rows are read once below.
  const ranking: Promise<(BreakdownRow | BreakdownMass)[]> = map
    ? Promise.resolve([])
    : groupBy === 'categoryGroup'
      ? spendingByCategoryGroup(userId, period.from, period.to, kind, reading)
      : spendingBreakdown(userId, period.from, period.to, groupBy, kind, reading)
  const [breakdown, tree, view, totals, previousTotals, monthly] = await Promise.all([
    ranking,
    map
      ? moneyMap({
          userId,
          period,
          kind,
          reading,
          split,
          labels: {
            unset: {
              activity: unset('activity'),
              group: unset('categoryGroup'),
              category: unset('category'),
              actor: unset('actor'),
            },
            rest: (count) => words('others', { count }),
            root: kind === 'expense' ? mapWords('allExpenses') : mapWords('allIncome'),
          },
        })
      : null,
    // How the ranking is drawn is the person's to settle, in Réglages.
    rankingViewPreference(userId),
    flowTotals(userId, period.from, period.to, reading),
    previous ? flowTotals(userId, previous.from, previous.to, reading) : null,
    band ? monthlyFlows(userId, band.from, band.to, reading) : [],
  ])

  const expenseNet = Number(totals.expenseNet)
  const expenseGross = Number(totals.expenseGross)
  const income = Number(totals.income)
  const incomeCount = Number(totals.incomeCount)
  const saved = income - expenseNet
  const savingRate = income > 0 ? Math.round((saved / income) * 100) : null
  const pace = paceMonths(period, firstDay, now, reading)

  const amounts = (r: BreakdownRow) => ({
    key: r.key,
    label: r.label,
    gross: Number(r.gross),
    net: Number(r.net),
    count: Number(r.count),
  })
  const rows = breakdown.map((r) => ({
    ...amounts(r),
    categories: 'categories' in r ? r.categories.map(amounts) : undefined,
  }))
  const emptyLabel = kind === 'expense' ? t('ranking.emptyExpense') : t('ranking.emptyIncome')

  return (
    <>
      <PeriodHeader title={screens('analysis')} period={period} reading={reading} />

      <PageBody className="gap-8 pt-6">
        {/* The figures frame the ranking and stay smaller than it. The biggest
            line is the ranking's first row, so it is not a figure of its own. */}
        <FigureRow compact>
          <Figure
            compact
            label={t('figures.spent')}
            qualifier={flowQualifier}
            value={expenseNet}
            delta={
              previousTotals
                ? {
                    value: Math.round(expenseNet - Number(previousTotals.expenseNet)),
                    label: previous!.label,
                    invert: true,
                  }
                : undefined
            }
            note={
              expenseGross !== expenseNet
                ? t('figures.grossBeforeRefunds', { amount: format.eur(expenseGross) })
                : undefined
            }
          />
          <Figure
            compact
            label={t('figures.received')}
            qualifier={flowQualifier}
            value={income}
            delta={
              previousTotals
                ? { value: Math.round(income - Number(previousTotals.income)), label: previous!.label }
                : undefined
            }
            note={words('movements', { count: incomeCount })}
          />
          <Figure
            compact
            label={t('figures.saved')}
            qualifier={flowQualifier}
            value={saved}
            note={savingRate !== null ? t('figures.savingRate', { rate: savingRate }) : t('figures.noIncome')}
          />
          {/* On a single month the average is the total again. */}
          {pace !== null && (
            <Figure
              compact
              label={t('figures.pace')}
              qualifier={flowQualifier}
              value={expenseNet / pace}
              per={t('figures.perMonth')}
              note={t('figures.paceNote', { months: format.number(pace, 1) })}
            />
          )}
        </FigureRow>

        {(monthly.length > 1 || bandQualifier) && (
          <section aria-label={t('band')}>
            {bandQualifier && <p className="pb-1 text-[11.5px] text-faint">{bandQualifier}</p>}
            {/* No title: the months on the axis name the window, the two sides
                of the zero line name themselves, and each month is the way to
                reframe the screen on it. */}
            {monthly.length > 1 && (
              <FlowChart
                rows={monthly.map((m) => ({
                  month: m.month,
                  income: Number(m.income),
                  expenseGross: Number(m.expenseGross),
                  expenseNet: Number(m.expenseNet),
                }))}
                currentMonth={now.slice(0, 7)}
                selectedMonth={period.preset === 'month' ? period.ref : undefined}
                legend="axis"
                height={160}
              />
            )}
          </section>
        )}

        <section aria-label={t('ranking.label', { kind, dimension: t(`ranking.dimensions.${groupBy}`) })}>
          {/* The direction names the block, the dimension sorts it: both scope
              this ranking only, so they sit on it rather than in the header. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-3">
            <UrlTabs
              param="flow"
              fallback="expense"
              clears={[VIEW_PARAM, FOCUS_PARAM]}
              ariaLabel={t('ranking.flow')}
              options={[
                { value: 'expense', label: t('ranking.expense') },
                { value: 'income', label: t('ranking.income') },
              ]}
            />
            {flowQualifier && <span className="-ml-2 text-[11.5px] text-faint">{flowQualifier}</span>}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:ml-auto">
              {/* The map always reads masses down to movements: the dimension
                  sorts the ranking only, and what the map opens on, its masses
                  or the activities above them, is the one choice it adds. */}
              {map ? (
                <UrlTabs
                  param="split"
                  fallback="group"
                  clears={[VIEW_PARAM, FOCUS_PARAM]}
                  ariaLabel={t('ranking.split')}
                  options={[
                    { value: 'group', label: t('ranking.byGroup') },
                    { value: 'activity', label: t('ranking.byActivity') },
                  ]}
                />
              ) : (
                <UrlTabs
                  param="by"
                  fallback={DEFAULT_GROUP}
                  ariaLabel={t('ranking.groupBy')}
                  options={GROUPS.map((value) => ({ value, label: t(`ranking.options.${value}`) }))}
                />
              )}
              <UrlTabs
                param="view"
                fallback="ranking"
                clears={[VIEW_PARAM, FOCUS_PARAM]}
                ariaLabel={t('ranking.view')}
                // The ranking is drawn the way Réglages says, so its icon is
                // that drawing.
                options={[
                  {
                    value: 'ranking',
                    label: t('ranking.rankingView'),
                    icon: view === 'strip' ? <StripIcon /> : <BarsIcon />,
                  },
                  { value: 'map', label: t('ranking.mapView'), icon: <MapIcon /> },
                ]}
              />
            </div>
          </div>
          <div className="pt-3">
            {tree ? (
              tree.net > 0 ? (
                // A new reading is a new map: it opens where its URL says,
                // not where the previous one was left.
                <MoneyMap
                  key={`${period.from}|${period.to}|${kind}|${reading}|${split}`}
                  root={tree}
                  kind={kind}
                />
              ) : (
                <p className="py-3 text-[13px] text-faint">{emptyLabel}</p>
              )
            ) : view === 'strip' ? (
              <ShareRanking
                rows={rows}
                dimension={groupBy}
                link={{ from: 'analysis', period, kind }}
                emptyLabel={emptyLabel}
              />
            ) : (
              <BreakdownBars
                rows={rows}
                dimension={groupBy}
                link={{ from: 'analysis', period, kind }}
                size="lead"
                emptyLabel={emptyLabel}
              />
            )}
          </div>
        </section>
      </PageBody>
    </>
  )
}
