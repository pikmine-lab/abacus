import { auth } from '@abacus/core/auth'
import { today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import { latestCheck } from '@abacus/core/services/balanceChecks'
import {
  listCommitmentsWithProgress,
  monthlyEquivalent,
  pendingOccurrences,
} from '@abacus/core/services/commitments'
import { outstandingAdvances } from '@abacus/core/services/movements'
import {
  balanceSeries,
  firstMovementDay,
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
import { StatRow, StatTile } from '@/components/stats'
import { Badge } from '@/components/ui/badge'
import { previousWindow, resolvePeriod, seriesFrom } from '@/lib/period'
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
  searchParams: Promise<{ periode?: string; ref?: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const now = today()
  const period = resolvePeriod(await searchParams, now)
  const previous = previousWindow(period)

  const [accounts, firstDay, totals, previousTotals, monthly, breakdown, pending, advances, commitments] =
    await Promise.all([
      listAccounts(userId),
      firstMovementDay(userId),
      flowTotals(userId, period.from, period.to),
      previous ? flowTotals(userId, previous.from, previous.to) : null,
      // A month-by-month chart needs months: this window is named in the
      // section title and is deliberately not the page period.
      monthlyFlows(userId, shiftMonths(now, -11), now),
      spendingBreakdown(userId, period.from, period.to, 'category'),
      pendingOccurrences(userId),
      outstandingAdvances(userId),
      listCommitmentsWithProgress(userId),
    ])

  const active = commitments.filter((c) => !c.cancelledOn)
  const subscriptions = active.filter((c) => c.kind === 'subscription' && c.direction === 'outgoing')
  const financings = active.filter((c) => c.kind === 'financing')
  const pendingOut = pending.filter((p) => p.commitment.direction === 'outgoing')
  const pendingIn = pending.filter((p) => p.commitment.direction === 'incoming')

  if (accounts.length === 0 || firstDay === null) {
    const steps: Step[] = [
      {
        title: 'Déclare tes comptes',
        why: 'Un compte courant suffit pour commencer. C’est ce qui porte les soldes et rend tout le reste calculable.',
        href: '/comptes',
        cta: 'Ajouter un compte',
        done: accounts.length > 0,
      },
      {
        title: 'Déclare quelques mouvements',
        why: 'Dépenses, revenus, virements entre tes comptes. Dès le premier, les soldes et les graphes existent.',
        href: '/mouvements',
        cta: 'Déclarer',
        done: firstDay !== null,
      },
      {
        title: 'Déclare tes engagements récurrents',
        why: 'Abonnements et salaire : l’app en déduit ton coût mensuel engagé et te propose les échéances à confirmer.',
        href: '/depenses-recurrentes',
        cta: 'Ajouter',
        done: active.length > 0,
      },
    ]
    return (
      <>
        <PageHeader title="Bienvenue" />
        <Onboarding steps={steps} mcpHref="/brancher-une-ia" />
      </>
    )
  }

  const checks = await Promise.all(accounts.map((a) => latestCheck(userId, a.id)))
  const wealth = accounts.reduce((sum, a) => sum + Number(a.balance), 0)

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
  const monthlyCommitted = active
    .filter((c) => c.direction === 'outgoing')
    .reduce((sum, c) => sum + monthlyEquivalent(c), 0)
  const claims = advances.reduce((sum, a) => sum + Number(a.amount) - Number(a.refunded), 0)

  const staleChecks = accounts
    .map((account, i) => ({ account, check: checks[i] }))
    .filter(({ account, check }) => {
      if (account.closedOn) return false
      if (!check) return true
      return check.gap !== 0 || daysBetween(check.check.checkedOn, now) > STALE_CHECK_DAYS
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
      </FilterBar>

      <PageBody>
        <StatRow>
          <StatTile
            hero
            label="Patrimoine"
            value={eur(wealth)}
            href="/comptes?de=accueil"
            delta={
              days.length > 1
                ? { value: Math.round(wealthEnd - wealthStart), label: 'sur la période' }
                : undefined
            }
            hint={`${accounts.filter((a) => !a.closedOn).length} comptes ouverts`}
            spark={wealthSpark}
          />
          <StatTile
            label={`Épargné · ${period.label}`}
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
            label={`Dépensé · ${period.label}`}
            value={eur(expenseNet)}
            href="/analyse?de=accueil"
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
            href="/depenses-recurrentes?de=accueil"
            hint={`${subscriptions.length} abonnement${subscriptions.length > 1 ? 's' : ''}${
              financings.length > 0
                ? ` · ${financings.length} financement${financings.length > 1 ? 's' : ''}`
                : ''
            }`}
          />
        </StatRow>

        {(pending.length > 0 || staleChecks.length > 0 || claims > 0) && (
          <Section title="À faire" description="ce qui attend une décision de ta part">
            <Rows>
              {/* One line per direction: an occurrence to confirm lives on the
                  page of its own kind, and a single link could only guess. */}
              {[
                { items: pendingOut, href: '/depenses-recurrentes', noun: 'prélèvement' },
                { items: pendingIn, href: '/revenus-recurrents', noun: 'versement' },
              ]
                .filter((group) => group.items.length > 0)
                .map((group) => (
                  <Link
                    key={group.href}
                    href={`${group.href}?de=accueil`}
                    className="group flex items-baseline gap-3 py-2.5 hover:bg-secondary/40"
                  >
                    <CircleAlertIcon className="size-3.5 shrink-0 translate-y-0.5 text-primary" />
                    <span className="text-[13px]">
                      {group.items.length} {group.noun}
                      {group.items.length > 1 ? 's' : ''} à confirmer
                    </span>
                    <span className="text-[11.5px] text-faint">
                      attendu{group.items.length > 1 ? 's' : ''} depuis le {frDate(group.items[0]!.dueOn)}
                    </span>
                    <RowArrow />
                  </Link>
                ))}
              {staleChecks.length > 0 && (
                <Link
                  href="/comptes?de=accueil"
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
                          ? check.gap !== 0
                            ? `${account.name} : écart de ${eur(check.gap, 2)}`
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
                  href="/mouvements?avances=1&de=accueil"
                  className="group flex items-baseline gap-3 py-2.5 hover:bg-secondary/40"
                >
                  <CircleAlertIcon className="size-3.5 shrink-0 translate-y-0.5 text-faint" />
                  <span className="text-[13px]">{eur(claims)} avancés, en attente de remboursement</span>
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
          description={`${period.label} · calculé depuis les mouvements déclarés`}
          action={<SectionLink href="/comptes?de=accueil">Comptes</SectionLink>}
        >
          <BalanceChart
            accounts={accounts.filter((a) => !a.closedOn).map((a) => ({ id: a.id, name: a.name }))}
            rows={series.map((r) => ({ day: r.day, accountId: r.accountId, balance: Number(r.balance) }))}
            today={now}
          />
        </Section>

        <Section
          title="Ce qui rentre, ce qui sort"
          description="12 derniers mois · clic sur un mois pour cadrer la page dessus"
        >
          <FlowChart rows={monthlyRows} currentMonth={now.slice(0, 7)} />
        </Section>

        <div className="grid gap-8 lg:grid-cols-2">
          <Section
            title="Dépenses par catégorie"
            description={period.label}
            action={<SectionLink href="/analyse?de=accueil">Analyse</SectionLink>}
          >
            <BreakdownBars
              rows={breakdown.map((r) => ({
                key: r.key,
                label: r.label,
                gross: Number(r.gross),
                net: Number(r.net),
                count: Number(r.count),
              }))}
              filterParam="categorie"
              from="accueil"
              max={6}
              emptyLabel="Aucune dépense déclarée sur cette période."
            />
          </Section>

          <Section
            title="Prochaines échéances"
            description="abonnements, financements et revenus récurrents"
            action={<SectionLink href="/depenses-recurrentes?de=accueil">Tout voir</SectionLink>}
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
                          ? '/revenus-recurrents?de=accueil'
                          : '/depenses-recurrentes?de=accueil'
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
        </div>
      </PageBody>
    </>
  )
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
