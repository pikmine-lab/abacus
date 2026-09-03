import { auth } from '@abacus/core/auth'
import { today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import { latestCheck } from '@abacus/core/services/balanceChecks'
import {
  listCommitmentsWithProgress,
  monthlyEquivalentEur,
  pendingOccurrences,
} from '@abacus/core/services/commitments'
import { holdingsValue } from '@abacus/core/services/investments'
import { outstandingAdvances } from '@abacus/core/services/movements'
import type { BreakdownRow } from '@abacus/core/services/reports'
import {
  balanceSeries,
  firstDeclaredDay,
  flowTotals,
  monthlyFlows,
  spendingBreakdown,
} from '@abacus/core/services/reports'
import { CircleAlertIcon } from 'lucide-react'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BalanceChart } from '@/components/balance-chart'
import { BreakdownBars } from '@/components/breakdown-bars'
import { FlowChart } from '@/components/flow-chart'
import { Onboarding, type Step } from '@/components/onboarding'
import {
  EmptyLine,
  FilterBar,
  PageBody,
  PageHeader,
  RowArrow,
  Rows,
  Section,
  SectionLink,
} from '@/components/page-shell'
import { PeriodPicker } from '@/components/period-picker'
import { ReadingTabs } from '@/components/reading-tabs'
import { SpendingDonut } from '@/components/spending-donut'
import { StatRow, StatTile } from '@/components/stats'
import { Badge } from '@/components/ui/badge'
import { previousWindow, readingLabel, resolvePeriod, seriesFrom } from '@/lib/period'
import { currentReading } from '@/lib/reading'
import { daysBetween, eur, frDate, freshness } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const JUDGMENT = {
  essential: { label: 'essentiel', variant: 'secondary' as const },
  reducible: { label: 'réductible', variant: 'outline' as const },
  to_cancel: { label: 'à résilier', variant: 'default' as const },
}

/** A check older than this is worth pointing at: the declarative model drifts. */
const STALE_CHECK_DAYS = 45

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; ref?: string; reading?: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const now = today()
  const params = await searchParams
  const period = resolvePeriod(params, now)
  const previous = previousWindow(period)
  const reading = await currentReading(params, userId)
  // Everything made of flows is named after the reading it was read in.
  // Balances keep the bare period label: they have one reading and only one.
  const scope = readingLabel(period, reading)

  const [
    accounts,
    firstDay,
    totals,
    previousTotals,
    monthly,
    breakdown,
    byGroup,
    pending,
    advances,
    commitments,
  ] = await Promise.all([
    listAccounts(userId),
    firstDeclaredDay(userId),
    flowTotals(userId, period.from, period.to, reading),
    previous ? flowTotals(userId, previous.from, previous.to, reading) : null,
    // A month-by-month chart needs months: this window is named in the
    // section title and is deliberately not the page period.
    monthlyFlows(userId, shiftMonths(now, -11), now, reading),
    spendingBreakdown(userId, period.from, period.to, 'category', 'expense', reading),
    spendingBreakdown(userId, period.from, period.to, 'categoryGroup', 'expense', reading),
    pendingOccurrences(userId),
    outstandingAdvances(userId),
    listCommitmentsWithProgress(userId),
  ])

  const active = commitments.filter((c) => !c.cancelledOn)
  const subscriptions = active.filter((c) => c.kind === 'subscription' && c.direction === 'outgoing')
  const financings = active.filter((c) => c.kind === 'financing')
  // Only what reached its date is to do: the coming period's occurrences are
  // listed on their pages so an early debit can be recorded, not owed yet.
  const due = pending.filter((p) => !p.ahead)
  // A placement's occurrence is confirmed where it buys, so it counts as its
  // own line rather than among the debits.
  const pendingPlacements = due.filter((p) => p.placement !== null)
  const pendingOut = due.filter((p) => p.commitment.direction === 'outgoing' && p.placement === null)
  const pendingIn = due.filter((p) => p.commitment.direction === 'incoming')

  if (accounts.length === 0 || firstDay === null) {
    const steps: Step[] = [
      {
        title: 'Déclare tes comptes',
        why: 'Un compte courant suffit pour commencer. C’est ce qui porte les soldes et rend tout le reste calculable.',
        href: '/accounts',
        cta: 'Ajouter un compte',
        done: accounts.length > 0,
      },
      {
        title: 'Déclare quelques mouvements',
        why: 'Dépenses, revenus, virements entre tes comptes. Dès le premier, les soldes et les graphes existent.',
        href: '/movements',
        cta: 'Déclarer',
        done: firstDay !== null,
      },
      {
        title: 'Déclare tes engagements récurrents',
        why: 'Abonnements et salaire : l’app en déduit ton coût mensuel engagé et te propose les échéances à confirmer.',
        href: '/recurring-expenses',
        cta: 'Ajouter',
        done: active.length > 0,
      },
    ]
    return (
      <>
        <PageHeader title="Bienvenue" />
        <Onboarding steps={steps} mcpHref="/connect-ai" />
      </>
    )
  }

  const checks = await Promise.all(accounts.map((a) => latestCheck(userId, a.id)))
  // An investment account's balance is its cash, so the holdings have to be
  // added in: without them the total is wrong the moment a placement moves,
  // which is what this whole feature was for.
  const holdings = await holdingsValue(userId)
  const wealth = accounts.reduce((sum, a) => sum + Number(a.balance), 0) + holdings.value
  // See the accounts page: negative cash on an investment account is an
  // undeclared contribution, and the total is short by exactly that.
  const missingContributions = accounts
    .filter((a) => a.behavior === 'investment' && Number(a.balance) < 0)
    .reduce((sum, a) => sum - Number(a.balance), 0)

  const series = await balanceSeries(userId, seriesFrom(period, firstDay), period.to)
  const dayTotals = new Map<string, number>()
  for (const point of series)
    dayTotals.set(point.day, (dayTotals.get(point.day) ?? 0) + Number(point.balance))
  const days = [...dayTotals.keys()].sort()
  const wealthStart = dayTotals.get(days[0]!) ?? 0
  const wealthEnd = dayTotals.get(days[days.length - 1]!) ?? wealth
  const wealthSpark = sample(
    days.map((d) => dayTotals.get(d)!),
    12,
  )

  const expenseNet = Number(totals.expenseNet)
  const expenseGross = Number(totals.expenseGross)
  const income = Number(totals.income)
  const saved = income - expenseNet
  // Saving is not cost: a scheduled placement leaves the account like a
  // subscription, but the money stays the user's, so it is counted in
  // Placements and not here.
  const monthlyCommitted = active
    .filter((c) => c.direction === 'outgoing' && c.kind !== 'investment_plan')
    .reduce((sum, c) => sum + monthlyEquivalentEur(c), 0)
  // What is owed back, not what was spent: an advance covers a share of its
  // expense, so the claim is that share minus what already came back.
  const claims = advances.reduce((sum, a) => sum + Number(a.expectedRefundAmount) - Number(a.refunded), 0)

  const staleChecks = accounts
    .map((account, i) => ({ account, check: checks[i] }))
    .filter(({ account, check }) => {
      if (account.closedOn) return false
      if (!check) return true
      return check.openGap !== 0 || daysBetween(check.check.checkedOn, now) > STALE_CHECK_DAYS
    })

  const monthlyRows = monthly.map((m) => ({
    month: m.month,
    income: Number(m.income),
    expenseGross: Number(m.expenseGross),
    expenseNet: Number(m.expenseNet),
  }))

  return (
    <>
      <PageHeader title="Vue d’ensemble" description={`Période : ${period.label}`} />
      <FilterBar>
        <PeriodPicker period={period} />
        <ReadingTabs value={reading} />
      </FilterBar>

      <PageBody>
        <StatRow>
          <StatTile
            hero
            label="Patrimoine"
            value={eur(wealth)}
            href="/accounts?from=overview"
            delta={
              days.length > 1
                ? { value: Math.round(wealthEnd - wealthStart), label: 'sur la période' }
                : undefined
            }
            hint={
              missingContributions > 0
                ? `${eur(missingContributions)} d’apports non déclarés : pointe les espèces du compte`
                : holdings.value > 0
                  ? `${accounts.filter((a) => !a.closedOn).length} comptes, placements au dernier cours${
                      holdings.unpriced > 0 ? ` (${holdings.unpriced} sans cours)` : ''
                    }`
                  : `${accounts.filter((a) => !a.closedOn).length} comptes ouverts`
            }
            spark={wealthSpark}
          />
          <StatTile
            label={`Épargné · ${scope}`}
            value={eur(saved)}
            delta={
              previousTotals
                ? {
                    value: Math.round(
                      saved - (Number(previousTotals.income) - Number(previousTotals.expenseNet)),
                    ),
                    label: previous!.label,
                  }
                : undefined
            }
            hint={`${eur(income)} entrés − ${eur(expenseNet)} sortis`}
            spark={sample(
              monthlyRows.map((m) => m.income - m.expenseNet),
              12,
            )}
          />
          <StatTile
            label={`Dépensé · ${scope}`}
            value={eur(expenseNet)}
            href="/analysis?from=overview"
            delta={
              previousTotals
                ? {
                    value: Math.round(expenseNet - Number(previousTotals.expenseNet)),
                    label: previous!.label,
                    invert: true,
                  }
                : undefined
            }
            hint={
              expenseGross !== expenseNet
                ? `brut ${eur(expenseGross)} avant remboursements`
                : `${totals.expenseCount} mouvements`
            }
            spark={sample(
              monthlyRows.map((m) => m.expenseNet),
              12,
            )}
          />
          <StatTile
            label="Récurrent engagé"
            value={`${eur(monthlyCommitted, 2)}/mois`}
            href="/recurring-expenses?from=overview"
            hint={`${subscriptions.length} abonnement${subscriptions.length > 1 ? 's' : ''}${
              financings.length > 0
                ? ` · ${financings.length} financement${financings.length > 1 ? 's' : ''}`
                : ''
            }`}
          />
        </StatRow>

        {(due.length > 0 || staleChecks.length > 0 || claims > 0) && (
          <Section title="À faire" description="ce qui attend une décision de ta part">
            <Rows>
              {/* One line per direction: an occurrence to confirm lives on the
                  page of its own kind, and a single link could only guess. */}
              {[
                {
                  items: pendingOut,
                  href: '/recurring-expenses',
                  one: 'prélèvement',
                  many: 'prélèvements',
                },
                { items: pendingIn, href: '/recurring-income', one: 'versement', many: 'versements' },
                {
                  items: pendingPlacements,
                  href: '/investments',
                  one: 'versement programmé',
                  many: 'versements programmés',
                },
              ]
                .filter((group) => group.items.length > 0)
                .map((group) => (
                  <Link
                    key={group.href}
                    href={`${group.href}?from=overview`}
                    className="group flex items-baseline gap-3 py-2.5 hover:bg-secondary/40"
                  >
                    <CircleAlertIcon className="size-3.5 shrink-0 translate-y-0.5 text-primary" />
                    <span className="text-[13px]">
                      {group.items.length} {group.items.length > 1 ? group.many : group.one} à confirmer
                    </span>
                    <span className="text-[11.5px] text-faint">
                      attendu{group.items.length > 1 ? 's' : ''} depuis le {frDate(group.items[0]!.dueOn)}
                    </span>
                    <RowArrow />
                  </Link>
                ))}
              {staleChecks.length > 0 && (
                <Link
                  href="/accounts?from=overview"
                  className="group flex items-baseline gap-3 py-2.5 hover:bg-secondary/40"
                >
                  <CircleAlertIcon className="size-3.5 shrink-0 translate-y-0.5 text-faint" />
                  <span className="text-[13px]">
                    {staleChecks.length} compte{staleChecks.length > 1 ? 's' : ''} à pointer
                  </span>
                  <span className="truncate text-[11.5px] text-faint">
                    {staleChecks
                      .slice(0, 3)
                      .map(({ account, check }) =>
                        check
                          ? check.openGap !== 0
                            ? `${account.name} : écart de ${eur(check.openGap, 2)}`
                            : `${account.name} : pointé ${freshness(check.check.checkedOn, now)}`
                          : `${account.name} : jamais pointé`,
                      )
                      .join(' · ')}
                  </span>
                  <RowArrow />
                </Link>
              )}
              {claims > 0 && (
                <Link
                  href="/movements?advances=1&from=overview"
                  className="group flex items-baseline gap-3 py-2.5 hover:bg-secondary/40"
                >
                  <CircleAlertIcon className="size-3.5 shrink-0 translate-y-0.5 text-faint" />
                  <span className="text-[13px]">{eur(claims, 2)} en attente de remboursement</span>
                  <span className="text-[11.5px] text-faint">
                    {advances.length} avance{advances.length > 1 ? 's' : ''}
                  </span>
                  <RowArrow />
                </Link>
              )}
            </Rows>
          </Section>
        )}

        <Section
          title="Soldes"
          description={`${period.label}${reading === 'accrual' ? ' (date réelle)' : ''} · calculé depuis les mouvements déclarés`}
          action={<SectionLink href="/accounts?from=overview">Comptes</SectionLink>}
        >
          <BalanceChart
            lines={accounts.filter((a) => !a.closedOn).map((a) => ({ id: a.id, name: a.name }))}
            rows={series.map((r) => ({ day: r.day, lineId: r.accountId, balance: Number(r.balance) }))}
            today={now}
          />
        </Section>

        <Section
          title="Ce qui rentre, ce qui sort"
          description={`12 derniers mois${
            reading === 'accrual' ? ' (rattachement)' : ''
          } · clic sur un mois pour cadrer la page dessus`}
        >
          <FlowChart rows={monthlyRows} currentMonth={now.slice(0, 7)} />
        </Section>

        <div className="grid gap-8 lg:grid-cols-2">
          <Section title="Dépenses par groupe" description={scope}>
            <SpendingDonut rows={amounts(byGroup)} emptyLabel="Aucune dépense déclarée sur cette période." />
          </Section>

          <Section
            title="Dépenses par catégorie"
            description={scope}
            action={<SectionLink href="/analysis?from=overview">Analyse</SectionLink>}
          >
            <BreakdownBars
              rows={amounts(breakdown)}
              dimension="category"
              from="overview"
              max={6}
              emptyLabel="Aucune dépense déclarée sur cette période."
            />
          </Section>
        </div>

        <Section
          title="Prochaines échéances"
          description="abonnements, financements et revenus récurrents"
          action={<SectionLink href="/recurring-expenses?from=overview">Tout voir</SectionLink>}
        >
          {active.length === 0 ? (
            <EmptyLine>Aucun engagement déclaré.</EmptyLine>
          ) : (
            <Rows>
              {[...active]
                .sort((a, b) => a.nextDueOn.localeCompare(b.nextDueOn))
                .slice(0, 6)
                .map((c) => (
                  <Link
                    key={c.id}
                    href={
                      c.direction === 'incoming'
                        ? '/recurring-income?from=overview'
                        : '/recurring-expenses?from=overview'
                    }
                    className="group flex items-center gap-2 py-2.5 hover:bg-secondary/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px]">{c.label}</p>
                      <p className="text-[11px] text-faint">
                        {frDate(c.nextDueOn)}
                        {c.kind === 'financing' && c.progress
                          ? ` · ${c.progress.paidInstallments}/${c.installmentsTotal} échéances`
                          : ''}
                      </p>
                    </div>
                    {c.judgment && c.direction === 'outgoing' && (
                      <Badge variant={JUDGMENT[c.judgment].variant}>{JUDGMENT[c.judgment].label}</Badge>
                    )}
                    <span
                      className={`ml-auto font-mono text-[13px] font-semibold tabular ${
                        c.direction === 'incoming' ? 'text-good' : ''
                      }`}
                    >
                      {c.direction === 'incoming' ? '+' : '−'}
                      {eur(Number(c.amount), 2)}
                    </span>
                  </Link>
                ))}
            </Rows>
          )}
        </Section>
      </PageBody>
    </>
  )
}

/** Breakdown rows as the charts read them: numbers, not decimal strings. */
function amounts(rows: BreakdownRow[]) {
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    gross: Number(r.gross),
    net: Number(r.net),
    count: Number(r.count),
  }))
}

/** Evenly spaced sample of a series, keeping the last point. */
function sample(values: number[], count: number): number[] {
  if (values.length <= count) return values
  const step = (values.length - 1) / (count - 1)
  return Array.from({ length: count }, (_, i) => values[Math.round(i * step)]!)
}

function shiftMonths(iso: string, by: number): string {
  const [y, m] = iso.split('-').map(Number)
  const total = y! * 12 + (m! - 1) + by
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
}
