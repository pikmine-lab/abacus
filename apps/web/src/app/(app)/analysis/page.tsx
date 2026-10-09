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
import { BreakdownBars } from '@/components/breakdown-bars'
import { Figure, FigureRow } from '@/components/composition'
import { FlowChart } from '@/components/flow-chart'
import { PageBody } from '@/components/page-shell'
import { PeriodHeader } from '@/components/period-header'
import { ShareRanking } from '@/components/share-strip'
import { UrlTabs } from '@/components/url-tabs'
import { flowBandWindow } from '@/lib/flow-band'
import { paceMonths } from '@/lib/pace'
import { previousWindow, readingQualifier, resolvePeriod } from '@/lib/period'
import { currentReading } from '@/lib/reading'
import { eur } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Analyse' }

/**
 * The dimensions ranked here. The category group leads, and is the default: it
 * answers "where does the money go" in a handful of masses, then unfolds into
 * the categories it merges, which carry the link to the movements. It has no
 * entity of its own, which is why it unfolds instead of linking.
 */
const GROUPS = ['categoryGroup', 'category', 'actor', 'activity'] as const
type Ranked = (typeof GROUPS)[number]
const DEFAULT_GROUP: Ranked = 'categoryGroup'

/** How a dimension names itself, for the ranking's accessible name. */
const DIMENSION_NOUN: Record<Ranked, string> = {
  categoryGroup: 'groupe',
  category: 'catégorie',
  actor: 'acteur',
  activity: 'activité',
}

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string
    ref?: string
    by?: string
    flow?: string
    reading?: string
  }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const now = today()
  const params = await searchParams
  const period = resolvePeriod(params, now)
  const previous = previousWindow(period)
  const reading = await currentReading(params, userId)
  // Every flow figure says when the accrual reading is in force, as on the
  // overview; the band above them also names the whole months it covers.
  const flowQualifier = reading === 'accrual' ? 'rattachement' : undefined
  const bandQualifier = readingQualifier(period, reading)

  const groupBy = (GROUPS as readonly string[]).includes(params.by ?? '')
    ? (params.by as Ranked)
    : DEFAULT_GROUP
  const kind: FlowKind = params.flow === 'income' ? 'income' : 'expense'

  const firstDay = await firstDeclaredDay(userId)
  const band = flowBandWindow(period, firstDay, now.slice(0, 7))
  // A group comes back with the categories it merges, the other dimensions
  // with a flat row: one type covering both, so the rows are read once below.
  const ranking: Promise<(BreakdownRow | BreakdownMass)[]> =
    groupBy === 'categoryGroup'
      ? spendingByCategoryGroup(userId, period.from, period.to, kind, reading)
      : spendingBreakdown(userId, period.from, period.to, groupBy, kind, reading)
  const [breakdown, view, totals, previousTotals, monthly] = await Promise.all([
    ranking,
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
  const emptyLabel =
    kind === 'expense' ? 'Aucune dépense sur cette période.' : 'Aucun revenu sur cette période.'

  return (
    <>
      <PeriodHeader title="Analyse" period={period} reading={reading} />

      <PageBody className="gap-8 pt-6">
        {/* The figures frame the ranking and stay smaller than it. The biggest
            line is the ranking's first row, so it is not a figure of its own. */}
        <FigureRow compact>
          <Figure
            compact
            label="Dépensé"
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
            note={expenseGross !== expenseNet ? `brut ${eur(expenseGross)} avant remboursements` : undefined}
          />
          <Figure
            compact
            label="Reçu"
            qualifier={flowQualifier}
            value={income}
            delta={
              previousTotals
                ? { value: Math.round(income - Number(previousTotals.income)), label: previous!.label }
                : undefined
            }
            note={`${incomeCount} mouvement${incomeCount > 1 ? 's' : ''}`}
          />
          <Figure
            compact
            label="Épargné"
            qualifier={flowQualifier}
            value={saved}
            note={savingRate !== null ? `${savingRate} % de ce qui est entré` : 'aucun revenu déclaré'}
          />
          {/* On a single month the average is the total again. */}
          {pace !== null && (
            <Figure
              compact
              label="Rythme"
              qualifier={flowQualifier}
              value={expenseNet / pace}
              per="/mois"
              note={`dépensé en moyenne sur ${pace.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mois`}
            />
          )}
        </FigureRow>

        {(monthly.length > 1 || bandQualifier) && (
          <section aria-label="Entrées et sorties par mois">
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

        <section aria-label={`${kind === 'expense' ? 'Dépenses' : 'Revenus'} par ${DIMENSION_NOUN[groupBy]}`}>
          {/* The direction names the block, the dimension sorts it: both scope
              this ranking only, so they sit on it rather than in the header. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-3">
            <UrlTabs
              param="flow"
              fallback="expense"
              ariaLabel="Sens des flux"
              options={[
                { value: 'expense', label: 'Dépenses' },
                { value: 'income', label: 'Revenus' },
              ]}
            />
            {flowQualifier && <span className="-ml-2 text-[11.5px] text-faint">{flowQualifier}</span>}
            <div className="sm:ml-auto">
              <UrlTabs
                param="by"
                fallback={DEFAULT_GROUP}
                ariaLabel="Regrouper par"
                options={[
                  { value: 'categoryGroup', label: 'Groupe' },
                  { value: 'category', label: 'Catégorie' },
                  { value: 'actor', label: 'Acteur' },
                  { value: 'activity', label: 'Activité' },
                ]}
              />
            </div>
          </div>
          <div className="pt-3">
            {view === 'strip' ? (
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
