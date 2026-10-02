import { auth } from '@abacus/core/auth'
import type { ThresholdMeasure } from '@abacus/core/domain'
import { today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import {
  type ActivityAlert,
  activityAlerts,
  isRuleAlert,
  isThresholdAlert,
} from '@abacus/core/services/activityAlerts'
import { latestCheck } from '@abacus/core/services/balanceChecks'
import { listCards } from '@abacus/core/services/cards'
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
import { ActionCard, ActionGroup, ActionRow, Block, Figure, FigureRow } from '@/components/composition'
import { FlowChart } from '@/components/flow-chart'
import { Onboarding, type Step } from '@/components/onboarding'
import { EmptyLine, PageBody, PageHeader } from '@/components/page-shell'
import { PeriodHeader } from '@/components/period-header'
import { SpendingDonut } from '@/components/spending-donut'
import { Badge } from '@/components/ui/badge'
import { previousWindow, resolvePeriod, seriesFrom } from '@/lib/period'
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
    alerts,
    cards,
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
    activityAlerts(userId, now),
    listCards(userId),
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
  // A statement whose debit is expected by now waits for its day to be stated,
  // which is done on the card's page: one line per card, leading there.
  const statementsDue = cards
    .map((card) => ({ card, waiting: card.pending.filter((s) => s.dueOn <= now) }))
    .filter(({ waiting }) => waiting.length > 0)
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

  // Balances have one reading only: when the other one is chosen for the
  // flows, the block that ignores it says so.
  const flowQualifier = reading === 'accrual' ? 'rattachement' : undefined
  const wealthNote =
    missingContributions > 0
      ? `${eur(missingContributions)} d’apports non déclarés : pointe les espèces du compte`
      : holdings.value > 0
        ? `placements au dernier cours${holdings.unpriced > 0 ? `, ${holdings.unpriced} sans cours` : ''}`
        : undefined
  const pendingGroups = [
    { items: pendingOut, href: '/recurring-expenses', one: 'prélèvement', many: 'prélèvements' },
    { items: pendingIn, href: '/recurring-income', one: 'versement', many: 'versements' },
    {
      items: pendingPlacements,
      href: '/investments',
      one: 'versement programmé',
      many: 'versements programmés',
    },
  ].filter((group) => group.items.length > 0)

  return (
    <>
      <PeriodHeader title="Vue d’ensemble" period={period} reading={reading} />

      <PageBody className="gap-10 pt-8">
        {/* The one figure that dominates, beside the balances that explain it. */}
        <div className="grid items-end gap-8 lg:grid-cols-[minmax(18rem,4fr)_minmax(0,7fr)] lg:gap-12">
          <Figure
            hero
            label="Patrimoine"
            value={wealth}
            href="/accounts?from=overview"
            delta={days.length > 1 ? { value: Math.round(wealthEnd - wealthStart), label: '' } : undefined}
            note={wealthNote}
          />
          <Block
            label="Soldes"
            qualifier={reading === 'accrual' ? 'date réelle' : undefined}
            href="/accounts?from=overview"
            hrefLabel="Comptes"
          >
            <BalanceChart
              lines={accounts.filter((a) => !a.closedOn).map((a) => ({ id: a.id, name: a.name }))}
              rows={series.map((r) => ({ day: r.day, lineId: r.accountId, balance: Number(r.balance) }))}
              today={now}
            />
          </Block>
        </div>

        <FigureRow>
          <Figure
            label="Épargné"
            qualifier={flowQualifier}
            value={saved}
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
          />
          <Figure
            label="Dépensé"
            qualifier={flowQualifier}
            value={expenseNet}
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
            note={expenseGross !== expenseNet ? `brut ${eur(expenseGross)} avant remboursements` : undefined}
          />
          <Figure
            label="Engagé"
            value={monthlyCommitted}
            decimals={2}
            per="/mois"
            href="/recurring-expenses?from=overview"
            note={`${subscriptions.length} abonnement${subscriptions.length > 1 ? 's' : ''}${
              financings.length > 0
                ? ` · ${financings.length} financement${financings.length > 1 ? 's' : ''}`
                : ''
            }`}
          />
        </FigureRow>

        {(due.length > 0 ||
          staleChecks.length > 0 ||
          claims > 0 ||
          statementsDue.length > 0 ||
          alerts.length > 0) && (
          <ActionCard label="À faire">
            {/* One line per direction: an occurrence to confirm lives on the
                page of its own kind, and a single link could only guess. */}
            {pendingGroups.map((group) => (
              <ActionRow
                key={group.href}
                href={`${group.href}?from=overview`}
                icon={<CircleAlertIcon className="size-4 text-primary" />}
                title={`${group.items.length} ${group.items.length > 1 ? group.many : group.one} à confirmer`}
                detail={`depuis le ${frDate(group.items[0]!.dueOn)}`}
              />
            ))}
            {statementsDue.map(({ card, waiting }) => (
              <ActionRow
                key={card.id}
                href={`/accounts/cards/${card.id}?from=overview#statement-${waiting[0]!.id}`}
                icon={<CircleAlertIcon className="size-4 text-primary" />}
                title={`${waiting.length > 1 ? `${waiting.length} relevés` : 'Relevé'} de ${card.name} à valider`}
                detail={`${eur(
                  waiting.reduce((sum, s) => sum + Number(s.amount), 0),
                  2,
                )} depuis le ${frDate(waiting[0]!.dueOn)}`}
              />
            ))}
            {staleChecks.length > 0 && (
              <ActionRow
                href="/accounts?from=overview"
                icon={<CircleAlertIcon className="size-4 text-faint" />}
                title={`${staleChecks.length} compte${staleChecks.length > 1 ? 's' : ''} à pointer`}
                detail={staleChecks
                  .slice(0, 3)
                  .map(({ account, check }) =>
                    check
                      ? check.openGap !== 0
                        ? `${account.name} : écart de ${eur(check.openGap, 2)}`
                        : `${account.name} : pointé ${freshness(check.check.checkedOn, now)}`
                      : `${account.name} : jamais pointé`,
                  )
                  .join(' · ')}
              />
            )}
            {claims > 0 && (
              <ActionRow
                href="/movements?advances=1&from=overview"
                icon={<CircleAlertIcon className="size-4 text-faint" />}
                title={`${eur(claims, 2)} à récupérer`}
                detail={`${advances.length} avance${advances.length > 1 ? 's' : ''}`}
              />
            )}
            {/* Nothing when nothing alerts: a line saying "aucun seuil franchi"
                would take the place of the day a seuil is. What changes a regime asks
                for attention rather than a gesture, so it keeps its own label. */}
            {alerts.length > 0 && <ActionGroup label="Activité" />}
            {alerts.map((alert) => (
              <ActionRow
                key={`${alert.activityId}-${alert.kind}-${alert.subject}`}
                href={
                  isThresholdAlert(alert)
                    ? `/activity?activity=${alert.activityId}&from=overview`
                    : `/settings/activities/${alert.activityId}?from=overview`
                }
                icon={
                  <CircleAlertIcon
                    className={`size-4 ${
                      alert.kind === 'threshold_crossed'
                        ? 'text-destructive'
                        : alert.kind === 'threshold_near'
                          ? 'text-primary'
                          : 'text-faint'
                    }`}
                  />
                }
                title={alertHeadline(alert)}
                detail={alertDetail(alert)}
              />
            ))}
          </ActionCard>
        )}

        {/* No title: the months on the axis name the window, and the two sides
            of the zero line name themselves. */}
        <section aria-label="Entrées et sorties, douze derniers mois">
          {flowQualifier && <p className="pb-1 text-[11.5px] text-faint">{flowQualifier}</p>}
          <FlowChart
            rows={monthlyRows}
            currentMonth={now.slice(0, 7)}
            selectedMonth={period.preset === 'month' ? period.ref : undefined}
            legend="axis"
          />
        </section>

        <Block
          label="Dépenses"
          qualifier={flowQualifier}
          href="/analysis?from=overview"
          hrefLabel="Analyse"
          rule
        >
          {byGroup.length === 0 && breakdown.length === 0 ? (
            <EmptyLine>Aucune dépense déclarée sur cette période.</EmptyLine>
          ) : (
            <div className="grid gap-8 pt-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12">
              <SpendingDonut
                rows={amounts(byGroup)}
                emptyLabel="Aucune dépense déclarée sur cette période."
              />
              <BreakdownBars
                rows={amounts(breakdown)}
                dimension="category"
                from="overview"
                period={period}
                max={6}
                emptyLabel="Aucune dépense déclarée sur cette période."
              />
            </div>
          )}
        </Block>

        <Block label="À venir" href="/recurring-expenses?from=overview" hrefLabel="Toutes les échéances" rule>
          {active.length === 0 ? (
            <EmptyLine>Aucun engagement déclaré.</EmptyLine>
          ) : (
            <div className="flex flex-col divide-y divide-border">
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
                    // On a phone the date and the judgment drop under the name, so
                    // the name is not cut to make room for them.
                    className="group -mx-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-md px-2 py-2.5 hover:bg-secondary/40 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto_7rem]"
                  >
                    <span className="col-start-1 row-start-2 font-mono text-[12px] text-faint tabular sm:row-start-1">
                      {frDate(c.nextDueOn)}
                    </span>
                    <span className="col-start-1 row-start-1 truncate text-[13.5px] sm:col-start-2">
                      {c.label}
                      {c.kind === 'financing' && c.progress && (
                        <span className="ml-2 text-[12px] text-faint">
                          {c.progress.paidInstallments}/{c.installmentsTotal} échéances
                        </span>
                      )}
                    </span>
                    {c.judgment && c.direction === 'outgoing' && (
                      <Badge
                        variant={JUDGMENT[c.judgment].variant}
                        className="col-start-2 row-start-2 justify-self-end sm:col-start-3 sm:row-start-1"
                      >
                        {JUDGMENT[c.judgment].label}
                      </Badge>
                    )}
                    <span
                      className={`col-start-2 row-start-1 text-right font-mono text-[13px] font-semibold tabular sm:col-start-4 ${
                        c.direction === 'incoming' ? 'text-good' : ''
                      }`}
                    >
                      {c.direction === 'incoming' ? '+' : '−'}
                      {eur(Number(c.amount), 2)}
                    </span>
                  </Link>
                ))}
            </div>
          )}
        </Block>
      </PageBody>
    </>
  )
}

/** A threshold's figures: every measure is money but the share of receipts that bore a withholding. */
function thresholdFigure(measure: ThresholdMeasure, value: number): string {
  return measure === 'withholding_share' ? `${Math.round(value)} %` : eur(value)
}

/** What the alert is, in two to five words. */
function alertHeadline(alert: ActivityAlert): string {
  switch (alert.kind) {
    case 'threshold_crossed':
      return `${alert.subject} franchi`
    case 'threshold_near':
      return `${alert.subject} bientôt atteint`
    case 'rule_review_due':
      return `${alert.subject} à revérifier`
    case 'rule_unconfirmed':
      return `${alert.subject} non confirmé`
    case 'activity_unreadable':
      return `${alert.subject} : relevé illisible`
  }
}

/**
 * What it is worth. On a threshold the sentence ends on the consequence the
 * user wrote: what a crossing costs is a fact of a regime, so it is written
 * once, in the configuration, and never here.
 */
function alertDetail(alert: ActivityAlert): string {
  if (isThresholdAlert(alert))
    return [
      alert.activityName,
      `${thresholdFigure(alert.measure, alert.current)} pour un ${alert.comparison === 'lte' ? 'plafond' : 'plancher'} à ${thresholdFigure(alert.measure, alert.value)}`,
      alert.consequence,
    ].join(' · ')
  if (isRuleAlert(alert))
    return [
      alert.activityName,
      alert.kind === 'rule_review_due'
        ? `à revérifier depuis le ${frDate(alert.reviewOn!)}`
        : 'aucun texte ne fixe cette valeur',
      alert.verifiedOn ? `vérifié le ${frDate(alert.verifiedOn)}` : null,
    ]
      .filter(Boolean)
      .join(' · ')
  return `une règle porte des paramètres illisibles : corrige-la pour retrouver les chiffres de l’activité`
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

function shiftMonths(iso: string, by: number): string {
  const [y, m] = iso.split('-').map(Number)
  const total = y! * 12 + (m! - 1) + by
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
}
