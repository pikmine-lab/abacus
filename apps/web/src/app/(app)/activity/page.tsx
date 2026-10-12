import { auth } from '@abacus/core/auth'
import type { RevenueBasis } from '@abacus/core/domain'
import { fiscalYearOf, periodsOf } from '@abacus/core/domain/levy-engine'
import { endOfMonth, today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import { activityLevies, activityStatement } from '@abacus/core/services/activityStatement'
import { listActors } from '@abacus/core/services/actors'
import { listActivities, listActivityAccounts } from '@abacus/core/services/catalog'
import { listInvoices, outstandingInvoices } from '@abacus/core/services/invoices'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { ActivityMonths } from '@/components/activity-months'
import { ActivityPayout } from '@/components/activity-payout'
import { ActivityRanks, type RankRow } from '@/components/activity-ranks'
import { EntrySheet } from '@/components/entry-sheet'
import { FiscalYearPicker } from '@/components/fiscal-year-picker'
import { FoldSection } from '@/components/fold-section'
import { InvoiceForm } from '@/components/invoice-form'
import { type DueEntry, LevySchedule } from '@/components/levy-schedule'
import { type Step, StepPath } from '@/components/onboarding'
import { OutstandingInvoices } from '@/components/outstanding-invoices'
import {
  EmptyLine,
  FilterBar,
  PageBody,
  PageHeader,
  Rows,
  Section,
  SectionLink,
} from '@/components/page-shell'
import { StatRow, StatTile } from '@/components/stats'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { UrlTabs } from '@/components/url-tabs'
import { type Format, useFormat } from '@/lib/format'
import { getFormat } from '@/lib/format-server'
import { getLevyWords } from '@/lib/levy-words-server'
import { rangeRef } from '@/lib/period'
import { idParam } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getTranslations('activity')
  return { title: t('title') }
}

const PATH = '/activity'

type ActivityT = ReturnType<typeof useTranslations<'activity'>>

/** The words and formatters the helpers below write with, in the request's language. */
interface Words {
  t: ActivityT
  format: Format
}

/**
 * A fiscal year says its year when it is the calendar one, and its two dates
 * otherwise: "exercice 2026" is unambiguous on 1 January, and says nothing
 * true where the year opens on 6 April.
 */
function fiscalYearSpan({ t, format }: Words, { from, to }: { from: string; to: string }): string {
  if (from.endsWith('-01-01')) return from.slice(0, 4)
  return t('fiscalYear.span', { from: format.date(from), to: format.date(to) })
}

function fiscalYearLabel(words: Words, range: { from: string; to: string }): string {
  return words.t('fiscalYear.named', { span: fiscalYearSpan(words, range) })
}

/**
 * How the regime counts a receipt, which is what decides every figure here.
 * The app's own cash/accrual reading does not apply on this page: the taxable
 * event does, and the screen names it rather than letting it be assumed.
 */
function basisWords(t: ActivityT, basis: RevenueBasis) {
  return {
    tile: t(`basis.${basis}.tile`),
    word: t(`basis.${basis}.word`),
    lower: t(`basis.${basis}.lower`),
    sentence: t(`basis.${basis}.sentence`),
  }
}

/**
 * The ledger's own way of saying a window, so a figure leads to the movements
 * that make it and not to some neighbouring span. A calendar month or year
 * takes its preset; anything else, a fiscal year opening in April above all,
 * travels as the range itself.
 */
function periodQuery(from: string, to: string): string {
  if (from.endsWith('-01') && to === endOfMonth(from)) return `period=month&ref=${from.slice(0, 7)}`
  if (from.endsWith('-01-01') && to === `${from.slice(0, 4)}-12-31`)
    return `period=year&ref=${from.slice(0, 4)}`
  return `period=range&ref=${rangeRef(from, to)}`
}

/**
 * A period of the year, named the way a person names it: its month, its
 * exercise when it is the whole year, its two dates otherwise. A quarter has
 * no name that would not borrow a regime's vocabulary, so it keeps its dates.
 */
function periodName(
  words: Words,
  range: { from: string; to: string },
  year: { from: string; to: string },
): string {
  if (range.from === year.from && range.to === year.to) return fiscalYearLabel(words, year)
  if (range.from.endsWith('-01') && range.to === endOfMonth(range.from))
    return words.format.monthLong(range.from)
  return words.t('fiscalYear.span', {
    from: words.format.date(range.from),
    to: words.format.date(range.to),
  })
}

/**
 * One independent activity on one exercise: what came in, what it owes, what
 * is left, what may be taken out today, and what is still to declare. Every
 * figure is an estimate computed from the rules the activity declares, so the
 * screen names the rule behind a figure and the state that rule is in.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const params = await searchParams
  const { error } = params
  const now = today()
  const [t, format] = await Promise.all([getTranslations('activity'), getFormat()])
  const words: Words = { t, format }

  const [activities, actors, accounts, links] = await Promise.all([
    listActivities(userId),
    listActors(userId),
    listAccounts(userId),
    listActivityAccounts(userId),
  ])
  const businesses = activities.filter((a) => a.kind === 'business')
  const wanted = idParam(params.activity)

  // A personal activity is a dimension of Analyse, not a business with a
  // regime: the page says so rather than showing a statement it has none of.
  const personal = activities.find((a) => a.id === wanted && a.kind === 'personal')
  if (personal)
    return (
      <>
        <PageHeader title={t('title')} description={personal.name} />
        <PageBody>
          <EmptyLine>
            {t.rich('personal', {
              name: personal.name,
              link: (chunks) => (
                <Link href="/analysis?by=activity&from=activity" className="text-primary hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </EmptyLine>
        </PageBody>
      </>
    )

  if (businesses.length === 0)
    return (
      <>
        <PageHeader title={t('title')} description={t('noBusiness.description')} />
        <PageBody>
          <EmptyLine>
            {t.rich('noBusiness.body', {
              link: (chunks) => (
                <Link href="/settings?part=activities&from=activity" className="text-primary hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </EmptyLine>
        </PageBody>
      </>
    )

  // A stale or hand-typed parameter falls back on the first activity rather
  // than emptying the page.
  const activity = businesses.find((a) => a.id === wanted) ?? businesses[0]!
  const cal = { startMonth: activity.fiscalYearStartMonth, startDay: activity.fiscalYearStartDay }
  const runningYear = fiscalYearOf(now, cal)
  const last = activity.closedOn ? Math.min(runningYear, fiscalYearOf(activity.closedOn, cal)) : runningYear
  // Without a start date there is no first exercise to speak of: five years
  // back reaches whatever was declared without offering the epoch.
  const first = activity.startedOn ? fiscalYearOf(activity.startedOn, cal) : last - 5
  const asked = Number(params.year)
  const year = Number.isInteger(asked) ? Math.min(Math.max(asked, first), last) : last

  const [statement, open, invoices, rules] = await Promise.all([
    activityStatement(userId, activity.id, year, now),
    outstandingInvoices(userId, activity.id, now),
    listInvoices(userId, { activityId: activity.id, on: now }),
    activityLevies(userId, activity.id),
  ])

  // A rule is what makes the statement a statement: without one there are no
  // provisions, no reserve and no schedule, so the screen shows the way to
  // give the activity some rather than a page of zeros.
  if (rules.length === 0) {
    const steps: Step[] = [
      {
        title: t('setup.rules.title'),
        why: t('setup.rules.why'),
        href: `/settings/activities/${activity.id}?from=activity`,
        cta: t('setup.rules.cta'),
        done: false,
      },
      ...(links.some((l) => l.activityId === activity.id)
        ? []
        : [
            {
              title: t('setup.accounts.title'),
              why: t('setup.accounts.why'),
              href: `/settings?part=activities&entry=${activity.id}&from=activity`,
              cta: t('setup.accounts.cta'),
              done: false,
            },
          ]),
    ]
    return (
      <>
        <PageHeader
          title={t('title')}
          description={[activity.name, activity.jurisdiction, activity.regimeLabel]
            .filter(Boolean)
            .join(' · ')}
        />
        {businesses.length > 1 && (
          <FilterBar>
            <UrlTabs
              param="activity"
              fallback={businesses[0]!.id}
              ariaLabel={t('title')}
              options={businesses.map((a) => ({ value: a.id, label: a.name }))}
            />
          </FilterBar>
        )}
        <PageBody>
          <div className="flex max-w-xl flex-col gap-3">
            <p className="text-[13px] text-muted-foreground">
              {steps.length === 1 ? t('setup.oneStep') : t('setup.twoSteps')}
            </p>
            <StepPath steps={steps} />
          </div>
        </PageBody>
      </>
    )
  }
  const { totals, payableToSelf } = statement
  const basis = basisWords(t, statement.basis)
  const otherBasis = totals.revenueOtherBasis.basis
  const period = statement.activity.period
  const running = year === runningYear

  const back = `${PATH}?activity=${activity.id}${running ? '' : `&year=${year}`}`
  const ledger = (from: string, to: string, extra = '') =>
    `/movements?${periodQuery(from, to)}&activity=${activity.id}${extra}&from=activity`

  // The fiscal months in the order the statement lists them, so a month row
  // leads to its own window even where a fiscal month is not a calendar one.
  const fiscalMonths = periodsOf(year, cal, 'month')
  const elapsed = statement.months.filter((_, i) => fiscalMonths[i]!.from <= statement.asOf)

  const actorName = new Map(actors.map((a) => [a.id, a.name]))
  const usable = accounts.filter((a) => !a.closedOn)
  const lives = new Set(links.filter((l) => l.activityId === activity.id).map((l) => l.accountId))
  const ownAccounts = usable.filter((a) => lives.has(a.id)).map((a) => ({ id: a.id, name: a.name }))
  // Paying oneself lands on an account this activity does not live on, which
  // an account shared with another activity still is.
  const outsideAccounts = usable.filter((a) => !lives.has(a.id)).map((a) => ({ id: a.id, name: a.name }))
  // The activity's own accounts first: an invoice lands there, and an account
  // outside it is still reachable for the case where it did not.
  const settlementAccounts = [...ownAccounts, ...outsideAccounts]

  const clients = actors.map((a) => ({
    id: a.id,
    name: a.name,
    vatRate: a.invoiceVatRate ?? undefined,
    withholdingRate: a.invoiceWithholdingRate ?? undefined,
  }))

  const toReview = statement.levies.filter((l) => l.reviewDue).length
  const extended = statement.levies.filter((l) => l.status === 'extended_by_default').length
  const unconfirmed = statement.levies.filter((l) => l.status === 'unconfirmed').length
  const caveats = [
    toReview > 0 && t('caveats.toReview', { count: toReview }),
    extended > 0 && t('caveats.extended', { count: extended }),
    unconfirmed > 0 && t('caveats.unconfirmed', { count: unconfirmed }),
  ].filter((line): line is string => line !== false)

  const schedule: DueEntry[] = statement.schedule.map((entry) => ({
    key: `${entry.levyId}-${entry.entry}-${entry.period.from}-${entry.instalment}`,
    levyId: entry.levyId,
    levyName: entry.levyName,
    periodStart: entry.period.from,
    entry: entry.entry,
    instalmentNumber: entry.instalment,
    what:
      entry.entry === 'regularization'
        ? t('fiscalYear.regularization', { span: fiscalYearSpan(words, entry.period) })
        : periodName(words, entry.period, period),
    window: t('schedule.window', {
      from: format.date(entry.declaration.from),
      to: format.date(entry.declaration.to),
    }),
    opensOn: entry.declaration.from,
    dueOn: entry.payment.to,
    amount: entry.amount,
    status: entry.status,
    absorbed: entry.absorbed,
    instalment:
      entry.instalments > 1
        ? t('schedule.instalment', { number: entry.instalment, total: entry.instalments })
        : undefined,
    paidOn: entry.paidOn,
    paidAmount: entry.paidAmount,
    missingInputs: entry.missingInputs,
    nilReturn: entry.nilReturn,
  }))

  const revenueRows: RankRow[] = statement.revenueByClient.map((row) => ({
    key: row.key ?? 'none',
    label: row.label ?? t('noClient'),
    amount: row.amount,
    href: row.key ? ledger(period.from, period.to, `&actor=${row.key}`) : undefined,
  }))
  const chargeRows: RankRow[] = statement.expensesByCategory.map((row) => ({
    key: row.key ?? 'none',
    label: row.label ?? t('noCategory'),
    amount: row.amount,
    settlement: row.settlesLevy,
    href: row.key ? ledger(period.from, period.to, `&category=${row.key}`) : undefined,
  }))

  const levy = await getLevyWords()

  const ofTheYear = invoices.filter((i) => i.issuedOn >= period.from && i.issuedOn <= period.to)

  return (
    <>
      <PageHeader
        title={t('title')}
        description={[activity.name, activity.regimeLabel, basis.sentence].filter(Boolean).join(' · ')}
      >
        <EntrySheet
          label={t('newInvoice.label')}
          title={t('newInvoice.title')}
          description={t('newInvoice.description')}
        >
          <InvoiceForm
            activities={businesses.map((a) => ({ id: a.id, name: a.name }))}
            actors={clients}
            defaults={{
              activityId: activity.id,
              vatRate: activity.defaultVatRate ?? undefined,
            }}
            today={now}
          />
        </EntrySheet>
      </PageHeader>

      <FilterBar>
        <FiscalYearPicker year={year} label={fiscalYearLabel(words, period)} first={first} last={last} />
        {businesses.length > 1 && (
          <>
            <span className="mx-1 hidden h-4 w-px bg-border sm:block" />
            <UrlTabs
              param="activity"
              fallback={businesses[0]!.id}
              ariaLabel={t('title')}
              options={businesses.map((a) => ({ value: a.id, label: a.name }))}
            />
          </>
        )}
      </FilterBar>

      <PageBody>
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
            {error}
          </p>
        )}

        {caveats.length > 0 && (
          <Link
            href={`/settings/activities/${activity.id}?from=activity`}
            className="text-[11.5px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
          >
            {t('caveats.tail', { caveats: caveats.join(' · ') })}
          </Link>
        )}

        <StatRow>
          <StatTile
            hero
            label={basis.tile}
            value={format.eur(totals.revenue)}
            hint={
              totals.revenueOtherBasis.revenue > 0
                ? t(`basis.${otherBasis}.other`, { amount: format.eur(totals.revenueOtherBasis.revenue) })
                : undefined
            }
            spark={elapsed.map((m) => m.revenue)}
            href={ledger(period.from, period.to)}
          />
          <StatTile
            label={t('stats.charges')}
            value={format.eur(totals.expenses + totals.leviesPaid)}
            hint={t('stats.chargesHint', {
              expenses: format.eur(totals.expenses),
              levies: format.eur(totals.leviesPaid),
            })}
          />
          {/* A net only deducts what was paid: what the rules are owed and not
              yet paid is said beside it, and taken off what may be paid out. */}
          <StatTile
            label={t('stats.net')}
            value={format.eur(totals.net)}
            hint={t('stats.netHint', { reserve: format.eur(statement.reserve) })}
          />
          {running ? (
            <StatTile
              label={t('stats.payable')}
              value={format.eur(payableToSelf.amount)}
              hint={payableToSelf.shared.length > 0 ? t('stats.payableHintShared') : t('stats.payableHint')}
              href="#payable"
            />
          ) : (
            <StatTile
              label={t('stats.paid')}
              value={format.eur(totals.paidToSelf)}
              hint={t('stats.paidHint')}
            />
          )}
        </StatRow>

        <Section title={t('months.title')} description={t('months.description')}>
          <ActivityMonths
            rows={statement.months.map((m) => ({
              month: m.month,
              revenue: m.revenue,
              charges: m.expenses + m.leviesPaid,
              net: m.net,
              paidToSelf: m.paidToSelf,
              running: m.running,
            }))}
            revenueWord={basis.word}
          />
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-32">{t('months.month')}</TableHead>
                <TableHead className="text-right">{basis.word}</TableHead>
                <TableHead className="hidden text-right sm:table-cell">{t('months.charges')}</TableHead>
                <TableHead className="text-right">{t('months.levies')}</TableHead>
                <TableHead className="text-right">{t('months.net')}</TableHead>
                <TableHead className="hidden text-right sm:table-cell">{t('months.paid')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {elapsed.map((m, i) => (
                <TableRow key={m.month}>
                  <TableCell className="text-[12.5px]">
                    <Link
                      href={ledger(fiscalMonths[i]!.from, fiscalMonths[i]!.to)}
                      className="hover:text-primary"
                    >
                      {format.month(m.month)}
                    </Link>
                    {m.running && (
                      <span className="pl-1.5 text-[11px] text-faint">{t('months.running')}</span>
                    )}
                  </TableCell>
                  <Money value={m.revenue} />
                  <Money value={m.expenses} muted className="hidden sm:table-cell" />
                  <Money value={m.leviesPaid} muted />
                  <Money value={m.net} />
                  <Money value={m.paidToSelf} muted className="hidden sm:table-cell" />
                </TableRow>
              ))}
              <TableRow className="font-semibold hover:bg-transparent">
                <TableCell className="text-[12.5px]">{fiscalYearSpan(words, period)}</TableCell>
                <Money value={totals.revenue} />
                <Money value={totals.expenses} className="hidden sm:table-cell" />
                <Money value={totals.leviesPaid} />
                <Money value={totals.net} />
                <Money value={totals.paidToSelf} className="hidden sm:table-cell" />
              </TableRow>
            </TableBody>
          </Table>
          {/* The column holds what the regime deducts: under a regime that
              deducts nothing, a row of zeros has to say where the money went. */}
          {statement.activity.deductibleExpenses === 'none' && (
            <p className="text-[11px] text-faint">{t('months.noDeductibleExpenses')}</p>
          )}
        </Section>

        <Section
          id="payable"
          className="scroll-mt-28"
          title={t('payable.title')}
          description={t('payable.description')}
          action={<SectionLink href="/accounts?from=activity">{t('payable.accounts')}</SectionLink>}
        >
          {running ? (
            <>
              <Rows>
                <MoneyRow
                  label={t('payable.treasury')}
                  hint={treasuryHint(t, payableToSelf.accounts)}
                  amount={payableToSelf.treasury}
                />
                <div className="py-2.5">
                  <div className="flex items-baseline gap-3">
                    <p className="text-[13px]">{t('payable.reserve')}</p>
                    <p className="min-w-0 truncate text-[11px] text-faint">{t('payable.reserveHint')}</p>
                    <p className="ml-auto font-mono text-[13px] tabular">
                      {format.eur(payableToSelf.reserve)}
                    </p>
                  </div>
                  {statement.levies.length > 0 && (
                    // The rules sit tight under the total they make: a rail and
                    // the indent say they belong to it, where a box would shout.
                    <div className="relative mt-1 flex flex-col gap-0.5 pl-4">
                      <span
                        aria-hidden
                        className="pointer-events-none absolute top-0 bottom-0 left-[5px] w-px rounded-full bg-input"
                      />
                      {[...statement.levies]
                        .sort((a, b) => b.reserve - a.reserve)
                        .map((rule) => {
                          const badge = levy.status(rule.status)
                          return (
                            <div key={rule.id} className="flex items-baseline gap-2">
                              <p className="flex shrink-0 items-baseline gap-1.5 text-[12px] text-muted-foreground">
                                {rule.name}
                                {badge && (
                                  <Badge variant={badge.variant} className="text-[10px]">
                                    {badge.label}
                                  </Badge>
                                )}
                                {rule.reviewDue && (
                                  <span className="text-[10.5px] text-destructive">
                                    {t('payable.review')}
                                  </span>
                                )}
                              </p>
                              <p className="min-w-0 truncate text-[11px] text-faint">
                                {[
                                  t('payable.owedPaid', {
                                    accrued: format.eur(rule.accrued, 2),
                                    paid: format.eur(rule.paid, 2),
                                  }),
                                  rule.overpaid > 0 &&
                                    t('payable.overpaid', { amount: format.eur(rule.overpaid, 2) }),
                                  rule.passThrough && t('payable.passThrough'),
                                  rule.assumedElectiveBase && t('payable.assumedBase'),
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
                              <p className="ml-auto font-mono text-[12px] tabular text-muted-foreground">
                                {format.eur(rule.reserve, 2)}
                              </p>
                            </div>
                          )
                        })}
                    </div>
                  )}
                </div>
                {payableToSelf.shared.length > 0 && (
                  // The other activities on those same accounts owe too, and
                  // the same euro cannot be promised twice: the line names
                  // them rather than letting the total look wrong.
                  <MoneyRow
                    label={t('payable.sharedReserve', {
                      names: payableToSelf.shared.map((o) => o.activityName).join(', '),
                    })}
                    hint={
                      payableToSelf.shared.some((o) => o.unreadable)
                        ? t('payable.sharedReserveUnreadable', {
                            names: payableToSelf.shared
                              .filter((o) => o.unreadable)
                              .map((o) => o.activityName)
                              .join(', '),
                          })
                        : t('payable.sharedReserveHint')
                    }
                    amount={payableToSelf.sharedReserve}
                  />
                )}
                <MoneyRow
                  label={t('payable.commitments', { date: format.date(endOfMonth(now)) })}
                  hint={t('payable.commitmentsHint')}
                  amount={payableToSelf.commitments}
                />
                <MoneyRow label={t('payable.available')} amount={payableToSelf.amount} strong />
              </Rows>
              <ActivityPayout
                activityId={activity.id}
                amount={payableToSelf.amount}
                from={ownAccounts}
                to={outsideAccounts}
                today={now}
              />
            </>
          ) : (
            <EmptyLine>{t('payable.pastYear', { amount: format.eur(totals.paidToSelf) })}</EmptyLine>
          )}
        </Section>

        <Section title={t('schedule.title')} description={t('schedule.description')}>
          <LevySchedule
            entries={schedule}
            accounts={ownAccounts.length > 0 ? ownAccounts : settlementAccounts}
            actors={actors.map((a) => ({ id: a.id, name: a.name }))}
            today={now}
            back={back}
          />
        </Section>

        <Section title={t('outstanding.title')} description={t('outstanding.description')}>
          {open.length === 0 ? (
            <EmptyLine>{t('outstanding.empty')}</EmptyLine>
          ) : (
            <OutstandingInvoices
              invoices={open.map((invoice) => ({
                invoiceId: invoice.id,
                client: actorName.get(invoice.actorId) ?? '?',
                reference: invoice.reference ?? undefined,
                issuedOn: invoice.issuedOn,
                dueOn: invoice.dueOn ?? undefined,
                remindedOn: invoice.remindedOn ?? undefined,
                overdue: invoice.state === 'overdue',
                receivable: Number(invoice.receivableAmount),
                paid: Number(invoice.paidAmount),
                remaining: Number(invoice.remainingAmount),
                draft: {
                  id: invoice.id,
                  client: actorName.get(invoice.actorId) ?? '',
                  reference: invoice.reference ?? undefined,
                  issuedOn: invoice.issuedOn,
                  dueOn: invoice.dueOn ?? undefined,
                  baseAmount: Number(invoice.baseAmount).toFixed(2),
                  vatRate: invoice.vatRate,
                  vatAmount: invoice.vatAmount,
                  withholdingRate: invoice.withholdingRate,
                  withholdingAmount: invoice.withholdingAmount,
                  note: invoice.note ?? undefined,
                },
              }))}
              accounts={settlementAccounts}
              actors={clients}
              today={now}
              back={back}
            />
          )}
        </Section>

        <div className="grid min-w-0 gap-8 lg:grid-cols-2">
          <Section title={t('ranks.revenueTitle')} description={basis.lower}>
            <ActivityRanks rows={revenueRows} emptyLabel={t('ranks.revenueEmpty')} />
          </Section>
          <Section title={t('ranks.chargesTitle')} description={t('ranks.chargesDescription')}>
            <ActivityRanks
              rows={chargeRows}
              emptyLabel={t('ranks.chargesEmpty')}
              note={t('ranks.settlementNote')}
            />
          </Section>
        </div>

        {statement.thresholds.length > 0 && (
          <Section title={t('thresholds.title')} description={t('thresholds.description')}>
            <Rows>
              {statement.thresholds.map((threshold) => (
                <div key={threshold.id} className="flex flex-col gap-1.5 py-2.5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <p className="text-[13px] font-medium">{threshold.label}</p>
                    <p className="text-[11px] text-faint">
                      {t(threshold.comparison === 'lte' ? 'thresholds.atMost' : 'thresholds.atLeast', {
                        measure: levy.measure(threshold.measure),
                        periodRef: levy.periodRef(threshold.periodRef),
                        value: levy.thresholdValue(threshold.measure, threshold.value),
                      })}
                    </p>
                    <p
                      className={`ml-auto font-mono text-[12.5px] tabular ${threshold.breached ? 'text-destructive' : ''}`}
                    >
                      {levy.thresholdValue(threshold.measure, threshold.current)}
                      <span className="pl-1.5 text-[11px] text-faint">
                        {t('thresholds.progress', { percent: Math.round(threshold.progress * 100) })}
                      </span>
                    </p>
                  </div>
                  <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                    <span
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${Math.min(Math.max(threshold.progress, 0), 1) * 100}%`,
                        background: threshold.breached ? 'var(--destructive)' : 'var(--chart-1)',
                      }}
                    />
                  </span>
                  <p
                    className={`text-[11.5px] ${threshold.breached ? 'text-destructive' : 'text-muted-foreground'}`}
                  >
                    {threshold.breached ? `${t('thresholds.breached')} ` : ''}
                    {threshold.consequence}
                  </p>
                </div>
              ))}
            </Rows>
          </Section>
        )}

        <FoldSection
          title={t('invoices.title')}
          description={t('invoices.count', { count: ofTheYear.length })}
        >
          {ofTheYear.length === 0 ? (
            <EmptyLine>{t('invoices.empty')}</EmptyLine>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-20">{t('invoices.date')}</TableHead>
                  <TableHead>{t('invoices.client')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('invoices.reference')}</TableHead>
                  <TableHead className="w-24 text-right">{t('invoices.base')}</TableHead>
                  <TableHead className="hidden w-24 text-right md:table-cell">{t('invoices.vat')}</TableHead>
                  <TableHead className="hidden w-24 text-right md:table-cell">
                    {t('invoices.withholding')}
                  </TableHead>
                  <TableHead className="w-24 text-right">{t('invoices.receivable')}</TableHead>
                  <TableHead className="w-24 text-right">{t('invoices.state')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ofTheYear.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-mono text-[11.5px] text-faint">
                      {format.date(invoice.issuedOn)}
                    </TableCell>
                    <TableCell className="text-[12.5px]">{actorName.get(invoice.actorId) ?? '?'}</TableCell>
                    <TableCell className="hidden text-[12px] text-muted-foreground sm:table-cell">
                      {invoice.reference ?? ''}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[12.5px] tabular">
                      {format.eur(Number(invoice.baseAmount), 2)}
                    </TableCell>
                    <TableCell className="hidden text-right font-mono text-[12.5px] tabular text-muted-foreground md:table-cell">
                      {format.eur(Number(invoice.vatAmount), 2)}
                    </TableCell>
                    <TableCell className="hidden text-right font-mono text-[12.5px] tabular text-muted-foreground md:table-cell">
                      {format.eur(Number(invoice.withholdingAmount), 2)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[13px] tabular">
                      {format.eur(Number(invoice.receivableAmount), 2)}
                      {Number(invoice.paidAmount) > 0 && invoice.state !== 'paid' && (
                        <span className="block text-[11px] font-normal text-faint">
                          {t('invoices.remaining', {
                            amount: format.eur(Number(invoice.remainingAmount), 2),
                          })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className={`text-right text-[11.5px] ${
                        invoice.state === 'overdue'
                          ? 'text-destructive'
                          : invoice.state === 'paid'
                            ? 'text-good'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {t(`invoiceState.${invoice.state}`)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </FoldSection>
      </PageBody>
    </>
  )
}

function Money({ value, muted, className }: { value: number; muted?: boolean; className?: string }) {
  const format = useFormat()
  return (
    <TableCell
      className={`text-right font-mono text-[12.5px] tabular ${muted ? 'text-muted-foreground' : ''} ${className ?? ''}`}
    >
      {format.eur(value)}
    </TableCell>
  )
}

/**
 * The accounts the treasury is made of, and the ones another activity lives on
 * too: a balance read whole while a neighbour draws on it would be read wrong.
 */
function treasuryHint(t: ActivityT, accounts: { name: string; sharedWith: string[] }[]): string {
  if (accounts.length === 0) return t('payable.noAccount')
  return accounts
    .map((a) =>
      a.sharedWith.length > 0
        ? t('payable.sharedAccount', { name: a.name, others: a.sharedWith.join(', ') })
        : a.name,
    )
    .join(' · ')
}

function MoneyRow({
  label,
  hint,
  amount,
  strong,
}: {
  label: string
  hint?: string
  amount: number
  strong?: boolean
}) {
  const format = useFormat()
  return (
    <div className="flex items-baseline gap-3 py-2.5">
      <p className={`text-[13px] ${strong ? 'font-semibold' : ''}`}>{label}</p>
      {hint && <p className="min-w-0 truncate text-[11px] text-faint">{hint}</p>}
      <p className={`ml-auto font-mono text-[13px] tabular ${strong ? 'font-semibold' : ''}`}>
        {format.eur(amount)}
      </p>
    </div>
  )
}
