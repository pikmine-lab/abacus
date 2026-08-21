import { auth } from '@abacus/core/auth'
import { today } from '@abacus/core/domain/period'
import type { BreakdownGroup, FlowKind } from '@abacus/core/services/reports'
import { firstMovementDay, flowTotals, monthlyFlows, spendingBreakdown } from '@abacus/core/services/reports'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { BreakdownBars } from '@/components/breakdown-bars'
import { FlowChart } from '@/components/flow-chart'
import { FilterBar, PageBody, PageHeader, Section } from '@/components/page-shell'
import { PeriodPicker } from '@/components/period-picker'
import { StatRow, StatTile } from '@/components/stats'
import { UrlTabs } from '@/components/url-tabs'
import { monthsInPeriod, previousWindow, resolvePeriod, seriesFrom } from '@/lib/period'
import { eur } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Analyse' }

const GROUPS: BreakdownGroup[] = ['category', 'actor', 'activity']

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; ref?: string; by?: string; flow?: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const now = today()
  const params = await searchParams
  const period = resolvePeriod(params, now)
  const previous = previousWindow(period)

  const groupBy = (GROUPS as string[]).includes(params.by ?? '') ? (params.by as BreakdownGroup) : 'category'
  const kind: FlowKind = params.flow === 'income' ? 'income' : 'expense'

  const firstDay = await firstMovementDay(userId)
  const [breakdown, totals, previousTotals, monthly] = await Promise.all([
    spendingBreakdown(userId, period.from, period.to, groupBy, kind),
    flowTotals(userId, period.from, period.to),
    previous ? flowTotals(userId, previous.from, previous.to) : null,
    monthlyFlows(userId, seriesFrom(period, firstDay), period.to),
  ])

  const expenseNet = Number(totals.expenseNet)
  const expenseGross = Number(totals.expenseGross)
  const income = Number(totals.income)
  const saved = income - expenseNet
  const savingRate = income > 0 ? Math.round((saved / income) * 100) : null
  const months = monthsInPeriod(period)

  const rows = breakdown.map((r) => ({
    key: r.key,
    label: r.label,
    gross: Number(r.gross),
    net: Number(r.net),
    count: Number(r.count),
  }))
  const shownTotal = rows.reduce((sum, r) => sum + r.gross, 0)

  return (
    <>
      <PageHeader title="Analyse" description="où part l’argent, d’où il vient" />
      <FilterBar>
        <PeriodPicker period={period} />
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
          fallback="category"
          ariaLabel="Regrouper par"
          options={[
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
            label={`Dépensé · ${period.label}`}
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
            label={`Reçu · ${period.label}`}
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
              value={rows[0] ? eur(rows[0].gross) : 'aucune'}
              hint={rows[0]?.label ?? 'rien sur cette période'}
            />
          )}
        </StatRow>

        {monthly.length > 1 && (
          <Section title="Ce qui rentre, ce qui sort" description={`${period.label}, mois par mois`}>
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
          title={`${kind === 'expense' ? 'Dépenses' : 'Revenus'} par ${
            { category: 'catégorie', actor: 'acteur', activity: 'activité' }[groupBy]
          }`}
          description={`${rows.length} ligne${rows.length > 1 ? 's' : ''} · total ${eur(shownTotal)} · clic pour voir les mouvements`}
        >
          <BreakdownBars
            rows={rows}
            filterParam={groupBy}
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
