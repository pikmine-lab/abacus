import { auth } from '@abacus/core/auth'
import type { RevenueBasis } from '@abacus/core/domain'
import { fiscalYearOf, periodsOf } from '@abacus/core/domain/levy-engine'
import { endOfMonth, today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import { activityLevies, activityStatement } from '@abacus/core/services/activityStatement'
import { listActors } from '@abacus/core/services/actors'
import { listActivities, listActivityAccounts } from '@abacus/core/services/catalog'
import { type InvoiceState, listInvoices, outstandingInvoices } from '@abacus/core/services/invoices'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
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
import {
  LEVY_MEASURE_LABEL,
  LEVY_PERIOD_REF_LABEL,
  LEVY_STATUS_BADGE,
  thresholdValue,
} from '@/lib/levy-words'
import { rangeRef } from '@/lib/period'
import { eur, frDate, frMonth, frMonthLong, idParam } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Activité' }

const PATH = '/activity'

/**
 * A fiscal year says its year when it is the calendar one, and its two dates
 * otherwise: "exercice 2026" is unambiguous on 1 January, and says nothing
 * true where the year opens on 6 April.
 */
function fiscalYearLabel({ from, to }: { from: string; to: string }): string {
  if (from.endsWith('-01-01')) return `exercice ${from.slice(0, 4)}`
  return `exercice ${frDate(from)} → ${frDate(to)}`
}

/**
 * How the regime counts a receipt, which is what decides every figure here.
 * The app's own cash/accrual reading does not apply on this page: the taxable
 * event does, and the screen names it rather than letting it be assumed.
 */
const BASIS: Record<RevenueBasis, { tile: string; word: string; sentence: string }> = {
  cash: {
    tile: 'Chiffre d’affaires encaissé',
    word: 'Encaissé',
    sentence: 'recettes comptées à l’encaissement',
  },
  invoiced: {
    tile: 'Chiffre d’affaires facturé',
    word: 'Facturé',
    sentence: 'recettes comptées à la facturation',
  },
}

const STATE_LABEL: Record<InvoiceState, string> = {
  pending: 'en attente',
  overdue: 'en retard',
  paid: 'encaissée',
  cancelled: 'annulée',
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count > 1 ? many : one}`
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
function periodName(range: { from: string; to: string }, year: { from: string; to: string }): string {
  if (range.from === year.from && range.to === year.to) return fiscalYearLabel(year)
  if (range.from.endsWith('-01') && range.to === endOfMonth(range.from)) return frMonthLong(range.from)
  return `${frDate(range.from)} → ${frDate(range.to)}`
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
        <PageHeader title="Activité" description={personal.name} />
        <PageBody>
          <EmptyLine>
            « {personal.name} » est une activité perso : elle n’a pas de régime, donc pas de relevé. Elle
            découpe les flux dans{' '}
            <Link href="/analysis?by=activity&from=activity" className="text-primary hover:underline">
              Analyse
            </Link>
            .
          </EmptyLine>
        </PageBody>
      </>
    )

  if (businesses.length === 0)
    return (
      <>
        <PageHeader title="Activité" description="factures, encaissements et relevé d’exercice" />
        <PageBody>
          <EmptyLine>
            Aucune activité indépendante déclarée. Dans{' '}
            <Link href="/settings?from=activity" className="text-primary hover:underline">
              Réglages
            </Link>
            , passe une activité en « indépendante » pour lui donner son exercice, ses factures et ses règles.
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
        title: 'Ses règles',
        why: 'Ce qu’elle doit, avec sa source et son calendrier : c’est ce qui remplit les provisions, la réserve et l’échéancier.',
        href: `/settings/activities/${activity.id}?from=activity`,
        cta: 'Réglages de l’activité',
        done: false,
      },
      ...(links.some((l) => l.activityId === activity.id)
        ? []
        : [
            {
              title: 'Ses comptes',
              why: 'Les comptes sur lesquels elle vit font sa trésorerie, donc ce qu’elle peut te verser.',
              href: '/settings?from=activity',
              cta: 'Réglages',
              done: false,
            },
          ]),
    ]
    return (
      <>
        <PageHeader
          title="Activité"
          description={[activity.name, activity.jurisdiction, activity.regimeLabel]
            .filter(Boolean)
            .join(' · ')}
        />
        {businesses.length > 1 && (
          <FilterBar>
            <UrlTabs
              param="activity"
              fallback={businesses[0]!.id}
              ariaLabel="Activité"
              options={businesses.map((a) => ({ value: a.id, label: a.name }))}
            />
          </FilterBar>
        )}
        <PageBody>
          <div className="flex max-w-xl flex-col gap-3">
            <p className="text-[13px] text-muted-foreground">
              {steps.length === 1 ? 'Un pas' : 'Deux pas'} et le relevé se remplit.
            </p>
            <StepPath steps={steps} />
          </div>
        </PageBody>
      </>
    )
  }
  const { totals, payableToSelf } = statement
  const basis = BASIS[statement.basis]
  const otherBasis = BASIS[totals.revenueOtherBasis.basis]
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
    toReview > 0 && `${plural(toReview, 'règle', 'règles')} à revérifier`,
    extended > 0 && `${plural(extended, 'prorogée', 'prorogées')} faute de texte`,
    unconfirmed > 0 && plural(unconfirmed, 'non confirmée', 'non confirmées'),
  ].filter((line): line is string => line !== false)

  const schedule: DueEntry[] = statement.schedule.map((entry) => ({
    key: `${entry.levyId}-${entry.entry}-${entry.period.from}-${entry.instalment}`,
    levyId: entry.levyId,
    levyName: entry.levyName,
    periodStart: entry.period.from,
    what:
      entry.entry === 'regularization'
        ? `régularisation de l’${fiscalYearLabel(entry.period)}`
        : periodName(entry.period, period),
    window: `dépôt du ${frDate(entry.declaration.from)} au ${frDate(entry.declaration.to)}`,
    opensOn: entry.declaration.from,
    dueOn: entry.payment.to,
    amount: entry.amount,
    status: entry.status,
    absorbed: entry.absorbed,
    instalment: entry.instalments > 1 ? `${entry.instalment} sur ${entry.instalments}` : undefined,
    paidOn: entry.paidOn,
    paidAmount: entry.paidAmount,
  }))

  const revenueRows: RankRow[] = statement.revenueByClient.map((row) => ({
    key: row.key ?? 'none',
    label: row.label ?? 'Sans client',
    amount: row.amount,
    href: row.key ? ledger(period.from, period.to, `&actor=${row.key}`) : undefined,
  }))
  const chargeRows: RankRow[] = statement.expensesByCategory.map((row) => ({
    key: row.key ?? 'none',
    label: row.label ?? 'Sans catégorie',
    amount: row.amount,
    settlement: row.settlesLevy,
    href: row.key ? ledger(period.from, period.to, `&category=${row.key}`) : undefined,
  }))

  const ofTheYear = invoices.filter((i) => i.issuedOn >= period.from && i.issuedOn <= period.to)

  return (
    <>
      <PageHeader
        title="Activité"
        description={[activity.name, activity.regimeLabel, basis.sentence].filter(Boolean).join(' · ')}
      >
        <EntrySheet
          label="Facture"
          title="Enregistrer une facture"
          description="Ce que la facture dit : facturé n’est pas encaissé, l’encaissement s’écrit quand l’argent arrive."
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
        <FiscalYearPicker year={year} label={fiscalYearLabel(period)} first={first} last={last} />
        {businesses.length > 1 && (
          <>
            <span className="mx-1 hidden h-4 w-px bg-border sm:block" />
            <UrlTabs
              param="activity"
              fallback={businesses[0]!.id}
              ariaLabel="Activité"
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
            {caveats.join(' · ')} : leurs montants sont les moins sûrs de l’écran.
          </Link>
        )}

        <StatRow>
          <StatTile
            hero
            label={basis.tile}
            value={eur(totals.revenue)}
            hint={
              totals.revenueOtherBasis.revenue > 0
                ? `${otherBasis.word.toLowerCase()} ${eur(totals.revenueOtherBasis.revenue)}`
                : undefined
            }
            spark={elapsed.map((m) => m.revenue)}
            href={ledger(period.from, period.to)}
          />
          <StatTile
            label="Charges"
            value={eur(totals.expenses + totals.provisions)}
            hint={`${eur(totals.provisions)} provisionnés · ${eur(totals.expenses)} sortis des comptes`}
          />
          <StatTile label="Net" value={eur(totals.net)} hint="recettes − charges − provisions" />
          {running ? (
            <StatTile
              label="Disponible à me verser"
              value={eur(payableToSelf.amount)}
              hint={
                payableToSelf.shared.length > 0
                  ? 'trésorerie − tout ce qui est dû sur ces comptes − échéances'
                  : 'trésorerie − réserve − échéances du mois'
              }
              href="#payable"
            />
          ) : (
            <StatTile
              label="Versé"
              value={eur(totals.paidToSelf)}
              hint="virements vers un compte hors activité"
            />
          )}
        </StatRow>

        <Section title="Par mois" description="ce qui est entré, et ce qu’il en reste">
          <ActivityMonths
            rows={statement.months.map((m) => ({
              month: m.month,
              revenue: m.revenue,
              charges: m.expenses + m.provisions,
              net: m.net,
              paidToSelf: m.paidToSelf,
              running: m.running,
            }))}
            revenueWord={basis.word}
          />
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-32">Mois</TableHead>
                <TableHead className="text-right">{basis.word}</TableHead>
                <TableHead className="text-right">Provisions</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Charges</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Versé</TableHead>
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
                      {frMonth(m.month)}
                    </Link>
                    {m.running && <span className="pl-1.5 text-[11px] text-faint">en cours</span>}
                  </TableCell>
                  <Money value={m.revenue} />
                  <Money value={m.provisions} muted />
                  <Money value={m.expenses} muted className="hidden sm:table-cell" />
                  <Money value={m.net} />
                  <Money value={m.paidToSelf} muted className="hidden sm:table-cell" />
                </TableRow>
              ))}
              <TableRow className="font-semibold hover:bg-transparent">
                <TableCell className="text-[12.5px]">
                  {fiscalYearLabel(period).replace('exercice ', '')}
                </TableCell>
                <Money value={totals.revenue} />
                <Money value={totals.provisions} />
                <Money value={totals.expenses} className="hidden sm:table-cell" />
                <Money value={totals.net} />
                <Money value={totals.paidToSelf} className="hidden sm:table-cell" />
              </TableRow>
            </TableBody>
          </Table>
        </Section>

        <Section
          id="payable"
          className="scroll-mt-28"
          title="À me verser"
          description="trésorerie de l’activité, moins ce qui est dû et pas encore payé"
          action={<SectionLink href="/accounts?from=activity">Comptes</SectionLink>}
        >
          {running ? (
            <>
              <Rows>
                <MoneyRow
                  label="Trésorerie"
                  hint={treasuryHint(payableToSelf.accounts)}
                  amount={payableToSelf.treasury}
                />
                <div className="py-2.5">
                  <div className="flex items-baseline gap-3">
                    <p className="text-[13px]">− Réserve</p>
                    <p className="min-w-0 truncate text-[11px] text-faint">ce qui est dû, règle par règle</p>
                    <p className="ml-auto font-mono text-[13px] tabular">{eur(payableToSelf.reserve)}</p>
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
                        .map((levy) => {
                          const badge = LEVY_STATUS_BADGE[levy.status]
                          return (
                            <div key={levy.id} className="flex items-baseline gap-2">
                              <p className="flex shrink-0 items-baseline gap-1.5 text-[12px] text-muted-foreground">
                                {levy.name}
                                {badge && (
                                  <Badge variant={badge.variant} className="text-[10px]">
                                    {badge.label}
                                  </Badge>
                                )}
                                {levy.reviewDue && (
                                  <span className="text-[10.5px] text-destructive">à revérifier</span>
                                )}
                              </p>
                              <p className="min-w-0 truncate text-[11px] text-faint">
                                {`dues ${eur(levy.accrued, 2)} · payées ${eur(levy.paid, 2)}`}
                                {levy.overpaid > 0 && ` · trop-payé ${eur(levy.overpaid, 2)}`}
                                {levy.passThrough && ' · collectée pour être reversée'}
                                {levy.assumedElectiveBase && ' · base non saisie, minimum retenu'}
                              </p>
                              <p className="ml-auto font-mono text-[12px] tabular text-muted-foreground">
                                {eur(levy.reserve, 2)}
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
                    label={`− Réserve de ${payableToSelf.shared.map((o) => o.activityName).join(', ')}`}
                    hint={
                      payableToSelf.shared.some((o) => o.unreadable)
                        ? `ce qui est dû sur les comptes partagés, sauf ${payableToSelf.shared
                            .filter((o) => o.unreadable)
                            .map((o) => o.activityName)
                            .join(', ')} dont une règle est illisible`
                        : 'ce qui est dû sur les comptes partagés'
                    }
                    amount={payableToSelf.sharedReserve}
                  />
                )}
                <MoneyRow
                  label={`− Échéances d’ici le ${frDate(endOfMonth(now))}`}
                  hint="engagements de l’activité"
                  amount={payableToSelf.commitments}
                />
                <MoneyRow label="Disponible" amount={payableToSelf.amount} strong />
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
            <EmptyLine>
              Le versable se lit sur l’exercice en cours : la trésorerie est celle d’aujourd’hui, pas celle de
              cet exercice. Sur cet exercice, {eur(totals.paidToSelf)} ont été versés.
            </EmptyLine>
          )}
        </Section>

        <Section title="Échéancier" description="ce qu’il faut déclarer et payer, en retard d’abord">
          <LevySchedule
            entries={schedule}
            accounts={ownAccounts.length > 0 ? ownAccounts : settlementAccounts}
            actors={actors.map((a) => ({ id: a.id, name: a.name }))}
            today={now}
            back={back}
          />
        </Section>

        <Section
          title="Factures en attente"
          description="« Encaissée » écrit le revenu sur le compte qui a reçu l’argent"
        >
          {open.length === 0 ? (
            <EmptyLine>Rien en attente : tout ce qui a été facturé est encaissé.</EmptyLine>
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
          <Section title="Recettes par client" description={basis.word.toLowerCase()}>
            <ActivityRanks rows={revenueRows} emptyLabel="Aucune recette sur cet exercice." />
          </Section>
          <Section title="Charges par catégorie" description="sorti des comptes de l’activité">
            <ActivityRanks
              rows={chargeRows}
              emptyLabel="Aucune charge sur cet exercice."
              note="en pointillé : règle une provision, déjà comptée dans les charges"
            />
          </Section>
        </div>

        {statement.thresholds.length > 0 && (
          <Section title="Seuils surveillés" description="où en est l’activité, et ce qui change au-delà">
            <Rows>
              {statement.thresholds.map((threshold) => (
                <div key={threshold.id} className="flex flex-col gap-1.5 py-2.5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <p className="text-[13px] font-medium">{threshold.label}</p>
                    <p className="text-[11px] text-faint">
                      {LEVY_MEASURE_LABEL[threshold.measure]} sur {LEVY_PERIOD_REF_LABEL[threshold.periodRef]}{' '}
                      · {threshold.comparison === 'lte' ? 'au plus' : 'au moins'}{' '}
                      {thresholdValue(threshold.measure, threshold.value)}
                    </p>
                    <p
                      className={`ml-auto font-mono text-[12.5px] tabular ${threshold.breached ? 'text-destructive' : ''}`}
                    >
                      {thresholdValue(threshold.measure, threshold.current)}
                      <span className="pl-1.5 text-[11px] text-faint">
                        {Math.round(threshold.progress * 100)} %
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
                    {threshold.breached ? 'Dépassé. ' : ''}
                    {threshold.consequence}
                  </p>
                </div>
              ))}
            </Rows>
          </Section>
        )}

        <FoldSection
          title="Factures de l’exercice"
          description={`${plural(ofTheYear.length, 'facture émise', 'factures émises')}`}
        >
          {ofTheYear.length === 0 ? (
            <EmptyLine>Aucune facture sur cet exercice.</EmptyLine>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-20">Date</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="hidden sm:table-cell">Référence</TableHead>
                  <TableHead className="w-24 text-right">HT</TableHead>
                  <TableHead className="hidden w-24 text-right md:table-cell">TVA</TableHead>
                  <TableHead className="hidden w-24 text-right md:table-cell">Retenue</TableHead>
                  <TableHead className="w-24 text-right">Net</TableHead>
                  <TableHead className="w-24 text-right">État</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ofTheYear.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-mono text-[11.5px] text-faint">
                      {frDate(invoice.issuedOn)}
                    </TableCell>
                    <TableCell className="text-[12.5px]">{actorName.get(invoice.actorId) ?? '?'}</TableCell>
                    <TableCell className="hidden text-[12px] text-muted-foreground sm:table-cell">
                      {invoice.reference ?? ''}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[12.5px] tabular">
                      {eur(Number(invoice.baseAmount), 2)}
                    </TableCell>
                    <TableCell className="hidden text-right font-mono text-[12.5px] tabular text-muted-foreground md:table-cell">
                      {eur(Number(invoice.vatAmount), 2)}
                    </TableCell>
                    <TableCell className="hidden text-right font-mono text-[12.5px] tabular text-muted-foreground md:table-cell">
                      {eur(Number(invoice.withholdingAmount), 2)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[13px] tabular">
                      {eur(Number(invoice.receivableAmount), 2)}
                      {Number(invoice.paidAmount) > 0 && invoice.state !== 'paid' && (
                        <span className="block text-[11px] font-normal text-faint">
                          reste {eur(Number(invoice.remainingAmount), 2)}
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
                      {STATE_LABEL[invoice.state]}
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
  return (
    <TableCell
      className={`text-right font-mono text-[12.5px] tabular ${muted ? 'text-muted-foreground' : ''} ${className ?? ''}`}
    >
      {eur(value)}
    </TableCell>
  )
}

/**
 * The accounts the treasury is made of, and the ones another activity lives on
 * too: a balance read whole while a neighbour draws on it would be read wrong.
 */
function treasuryHint(accounts: { name: string; sharedWith: string[] }[]): string {
  if (accounts.length === 0) return 'aucun compte déclaré sur cette activité'
  return accounts
    .map((a) => (a.sharedWith.length > 0 ? `${a.name} (partagé avec ${a.sharedWith.join(', ')})` : a.name))
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
  return (
    <div className="flex items-baseline gap-3 py-2.5">
      <p className={`text-[13px] ${strong ? 'font-semibold' : ''}`}>{label}</p>
      {hint && <p className="min-w-0 truncate text-[11px] text-faint">{hint}</p>}
      <p className={`ml-auto font-mono text-[13px] tabular ${strong ? 'font-semibold' : ''}`}>
        {eur(amount)}
      </p>
    </div>
  )
}
