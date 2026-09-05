import { auth } from '@abacus/core/auth'
import { fiscalYearOf, today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import { listActors } from '@abacus/core/services/actors'
import { listActivities } from '@abacus/core/services/catalog'
import { type InvoiceState, listInvoices, outstandingInvoices } from '@abacus/core/services/invoices'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { EntrySheet } from '@/components/entry-sheet'
import { InvoiceForm } from '@/components/invoice-form'
import { OutstandingInvoices } from '@/components/outstanding-invoices'
import { EmptyLine, FilterBar, PageBody, PageHeader, Section } from '@/components/page-shell'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { UrlTabs } from '@/components/url-tabs'
import { eur, frDate, idParam } from '@/lib/utils'

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

const STATE_LABEL: Record<InvoiceState, string> = {
  pending: 'en attente',
  overdue: 'en retard',
  paid: 'encaissée',
  cancelled: 'annulée',
}

/**
 * What an independent activity is doing: for now its invoices, from what a
 * client owes to what lands on the account. The statement of the fiscal year
 * (revenue, charges, provisions, what can be paid to oneself, thresholds)
 * comes with issue #12, which completes this page.
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

  const [activities, actors, accounts] = await Promise.all([
    listActivities(userId),
    listActors(userId),
    listAccounts(userId),
  ])
  const businesses = activities.filter((a) => a.kind === 'business')

  if (businesses.length === 0) {
    return (
      <>
        <PageHeader title="Activité" description="factures, encaissements et relevé d’exercice" />
        <PageBody>
          <EmptyLine>
            Aucune activité indépendante déclarée. Dans Réglages, passe une activité en « indépendante » pour
            lui donner ses factures et son exercice.
          </EmptyLine>
        </PageBody>
      </>
    )
  }

  // A stale or hand-typed parameter falls back on the first activity rather
  // than emptying the page.
  const wanted = idParam(params.activity)
  const activity = businesses.find((a) => a.id === wanted) ?? businesses[0]!
  const now = today()
  const year = fiscalYearOf(now, activity.fiscalYearStartMonth, activity.fiscalYearStartDay)

  const [open, invoices] = await Promise.all([
    outstandingInvoices(userId, activity.id, now),
    listInvoices(userId, { activityId: activity.id, on: now }),
  ])
  const ofTheYear = invoices.filter((i) => i.issuedOn >= year.from && i.issuedOn <= year.to)
  const actorName = new Map(actors.map((a) => [a.id, a.name]))

  // The activity's own accounts first: an invoice lands there, and an account
  // outside it is still reachable for the case where it did not.
  const usable = accounts.filter((a) => !a.closedOn)
  const settlementAccounts = [
    ...usable.filter((a) => a.activityId === activity.id),
    ...usable.filter((a) => a.activityId !== activity.id),
  ].map((a) => ({ id: a.id, name: a.name }))

  const clients = actors.map((a) => ({
    id: a.id,
    name: a.name,
    vatRate: a.invoiceVatRate ?? undefined,
    withholdingRate: a.invoiceWithholdingRate ?? undefined,
  }))
  const back = `${PATH}?activity=${activity.id}`

  return (
    <>
      <PageHeader
        title="Activité"
        description={[activity.name, activity.regimeLabel, fiscalYearLabel(year)].filter(Boolean).join(' · ')}
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

      <PageBody className="gap-6">
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
            {error}
          </p>
        )}

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

        <Section title="Factures de l’exercice">
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
        </Section>
      </PageBody>
    </>
  )
}
