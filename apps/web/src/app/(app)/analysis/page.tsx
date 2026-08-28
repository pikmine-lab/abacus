import { auth } from '@abacus/core/auth'
import { today } from '@abacus/core/domain/period'
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
import { BreakdownBars, UNSET_LABEL } from '@/components/breakdown-bars'
import { FlowChart } from '@/components/flow-chart'
import { FilterBar, PageBody, PageHeader, Section } from '@/components/page-shell'
import { PeriodPicker } from '@/components/period-picker'
import { ReadingTabs } from '@/components/reading-tabs'
import { StatRow, StatTile } from '@/components/stats'
import { UrlTabs } from '@/components/url-tabs'
import {
  monthsInPeriod,
  previousWindow,
  readingLabel,
  resolvePeriod,
  resolveReading,
  seriesFrom,
} from '@/lib/period'
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

/** How a dimension names itself in a title. */
const DIMENSION_NOUN: Record<Ranked, string> = {
  categoryGroup: 'groupe',
  category: 'catégorie',
  actor: 'acteur',
  activity: 'activité',
}

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; ref?: string; by?: string; flow?: string; reading?: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const now = today()
  const params = await searchParams
  const period = resolvePeriod(params, now)
  const previous = previousWindow(period)
  const reading = resolveReading(params)
  const scope = readingLabel(period, reading)

  const groupBy = (GROUPS as readonly string[]).includes(params.by ?? '')
    ? (params.by as Ranked)
    : DEFAULT_GROUP
  const kind: FlowKind = params.flow === 'income' ? 'income' : 'expense'

  const firstDay = await firstDeclaredDay(userId)
  // A group comes back with the categories it merges, the other dimensions
  // with a flat row: one type covering both, so the rows are read once below.
  const ranking: Promise<(BreakdownRow | BreakdownMass)[]> =
    groupBy === 'categoryGroup'
      ? spendingByCategoryGroup(userId, period.from, period.to, kind, reading)
      : spendingBreakdown(userId, period.from, period.to, groupBy, kind, reading)
  const [breakdown, totals, previousTotals, monthly] = await Promise.all([
    ranking,
    flowTotals(userId, period.from, period.to, reading),
    previous ? flowTotals(userId, previous.from, previous.to, reading) : null,
    monthlyFlows(userId, seriesFrom(period, firstDay), period.to, reading),
  ])

  const expenseNet = Number(totals.expenseNet)
  const expenseGross = Number(totals.expenseGross)
  const income = Number(totals.income)
  const saved = income - expenseNet
  const savingRate = income > 0 ? Math.round((saved / income) * 100) : null
  const months = monthsInPeriod(period)

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
  // The net, like every figure the ranking shows, so the section total and the
  // headline tile answer with the same number.
  const shownTotal = rows.reduce((sum, r) => sum + r.net, 0)

  return (
    <>
      <PageHeader title="Analyse" description="où part l’argent, d’où il vient" />
      <FilterBar>
        <PeriodPicker period={period} />
        {/* The reading belongs to the period: it says how the window is read,
            not what is shown in it. The divider marks that boundary. */}
        <ReadingTabs />
        <span className="mx-1 hidden h-4 w-px bg-border sm:block" />
        <UrlTabs
          param="flow"
          fallback="expense"
          ariaLabel="Sens des flux"
          options={[
            { value: 'expense', label: 'Dépenses' },
            { value: 'income', label: 'Revenus' },
          ]}
        />
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
      </FilterBar>

      <PageBody>
        <StatRow>
          <StatTile
            hero
            label={`Dépensé · ${scope}`}
            value={eur(expenseNet)}
            delta={
              previousTotals
                ? {
                    value: Math.round(expenseNet - Number(previousTotals.expenseNet)),
                    label: previous!.label,
                    invert: true,
                  }
                : undefined
            }
            hint={expenseGross !== expenseNet ? `brut ${eur(expenseGross)}` : undefined}
          />
          <StatTile
            label={`Reçu · ${scope}`}
            value={eur(income)}
            delta={
              previousTotals
                ? { value: Math.round(income - Number(previousTotals.income)), label: previous!.label }
                : undefined
            }
            hint={`${totals.incomeCount} mouvements`}
          />
          <StatTile
            label="Épargné"
            value={eur(saved)}
            hint={savingRate !== null ? `${savingRate} % de ce qui est entré` : 'aucun revenu déclaré'}
          />
          {/* On a single month the average is the total again; the biggest line
              is what actually answers "where did it go". */}
          {months > 1 ? (
            <StatTile
              label="Rythme mensuel"
              value={`${eur(expenseNet / months)}/mois`}
              hint={`moyenne sur ${months} mois`}
            />
          ) : (
            <StatTile
              label="Plus gros poste"
              value={rows[0] ? eur(rows[0].net) : 'aucune'}
              hint={rows[0] ? (rows[0].label ?? UNSET_LABEL[groupBy]) : 'rien sur cette période'}
            />
          )}
        </StatRow>

        {monthly.length > 1 && (
          <Section title="Ce qui rentre, ce qui sort" description={`${scope}, mois par mois`}>
            <FlowChart
              currentMonth={now.slice(0, 7)}
              rows={monthly.map((m) => ({
                month: m.month,
                income: Number(m.income),
                expenseGross: Number(m.expenseGross),
                expenseNet: Number(m.expenseNet),
              }))}
            />
          </Section>
        )}

        <Section
          title={`${kind === 'expense' ? 'Dépenses' : 'Revenus'} par ${DIMENSION_NOUN[groupBy]}`}
          description={`${rows.length} ligne${rows.length > 1 ? 's' : ''} · total ${eur(shownTotal)} · clic pour ${
            groupBy === 'categoryGroup' ? 'déplier les catégories' : 'voir les mouvements'
          }`}
        >
          <BreakdownBars
            rows={rows}
            dimension={groupBy}
            from="analysis"
            emptyLabel={
              kind === 'expense' ? 'Aucune dépense sur cette période.' : 'Aucun revenu sur cette période.'
            }
          />
        </Section>
      </PageBody>
    </>
  )
}
