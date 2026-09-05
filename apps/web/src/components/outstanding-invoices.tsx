'use client'

import { BanIcon, CalendarIcon, PencilIcon, SendIcon } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { DateField, FormSelect } from '@/components/forms'
import { type InvoiceDraft, InvoiceForm } from '@/components/invoice-form'
import { Rows } from '@/components/page-shell'
import { RowMenu } from '@/components/row-menu'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cancelInvoiceAction, remindInvoiceAction, settleInvoiceAction } from '@/lib/actions'
import { daysBetween, eur, frDate } from '@/lib/utils'

interface Option {
  id: string
  name: string
}

export interface OpenInvoice {
  invoiceId: string
  client: string
  reference?: string
  issuedOn: string
  dueOn?: string
  remindedOn?: string
  overdue: boolean
  receivable: number
  paid: number
  remaining: number
  /** The fields the correction panel reopens, as they were declared. */
  draft: InvoiceDraft
}

/**
 * Invoices still awaiting payment: work to do, so they live at the head of
 * the activity, out of any period, the way open advances do on the ledger.
 * The longest overdue is on top, because it is exactly the forgotten one.
 *
 * "Encaissée" writes the income on the account that received it, amount
 * editable: a client pays partially as often as in full, and ticking a flag
 * would leave the balance and the balance check saying otherwise.
 */
export function OutstandingInvoices({
  invoices,
  accounts,
  actors,
  today,
  back,
}: {
  invoices: OpenInvoice[]
  /** Where the money lands; the activity's accounts first. */
  accounts: Option[]
  actors: Option[]
  today: string
  /** Where a failed action comes back to, with its message. */
  back: string
}) {
  return (
    <Rows>
      {invoices.map((invoice) => (
        // Keyed on what is left: after a partial payment the row remounts, so
        // the amount field states the new remainder instead of the figure that
        // was just submitted.
        <InvoiceRow
          key={`${invoice.invoiceId}-${invoice.remaining}`}
          invoice={invoice}
          accounts={accounts}
          actors={actors}
          today={today}
          back={back}
        />
      ))}
    </Rows>
  )
}

function InvoiceRow({
  invoice,
  accounts,
  actors,
  today,
  back,
}: {
  invoice: OpenInvoice
  accounts: Option[]
  actors: Option[]
  today: string
  back: string
}) {
  const [dateOpen, setDateOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [state, cancel, pending] = useActionState(cancelInvoiceAction, {})
  const late = invoice.dueOn ? daysBetween(invoice.dueOn, today) : 0
  const label = `${invoice.client}${invoice.reference ? ` · ${invoice.reference}` : ''}`

  // Close on success only: a refused cancellation has a reason to show.
  useEffect(() => {
    if (state.ok) setConfirming(false)
  }, [state.ok])

  return (
    <div className="flex flex-wrap items-center gap-2 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium">{label}</p>
        <p className="text-[11px] text-faint">
          émise le {frDate(invoice.issuedOn)}
          {invoice.dueOn && ` · échéance le ${frDate(invoice.dueOn)}`}
          {invoice.remindedOn && ` · relancée le ${frDate(invoice.remindedOn)}`}
          {invoice.paid > 0 && ` · ${eur(invoice.paid, 2)} déjà encaissés`}
        </p>
      </div>

      {/* The state carries its own words: a colour alone would say nothing to
          whoever does not see it. */}
      <span
        className={`shrink-0 text-[11px] ${invoice.overdue ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {invoice.overdue ? `en retard de ${late} jour${late > 1 ? 's' : ''}` : 'en attente'}
      </span>

      <span className="ml-auto font-mono text-[13px] tabular">{eur(invoice.receivable, 2)}</span>

      <form action={settleInvoiceAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="invoiceId" value={invoice.invoiceId} />
        <input type="hidden" name="back" value={back} />
        <AmountInput
          name="amount"
          defaultValue={invoice.remaining.toFixed(2)}
          className="h-7 w-28 text-[12.5px]"
          aria-label={`Montant encaissé de ${invoice.client}`}
        />
        <div className="w-40">
          <FormSelect
            name="accountId"
            placeholder="Sur quel compte"
            ariaLabel={`Compte crédité par ${invoice.client}`}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
            defaultValue={accounts[0]?.id ?? ''}
          />
        </div>
        {dateOpen && (
          <div className="w-40">
            <DateField name="date" defaultValue={today} />
          </div>
        )}
        <Button size="sm" type="submit" className="h-7">
          Encaissée
        </Button>
      </form>

      <RowMenu label={label}>
        <DropdownMenuItem asChild>
          <form action={remindInvoiceAction}>
            <input type="hidden" name="invoiceId" value={invoice.invoiceId} />
            <input type="hidden" name="back" value={back} />
            <button type="submit" className="flex w-full items-center gap-2">
              <SendIcon />
              Relancée aujourd’hui
            </button>
          </form>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setDateOpen((v) => !v)}>
          <CalendarIcon />
          {dateOpen ? 'Encaissée aujourd’hui' : 'Encaissée à une autre date…'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setEditing(true)}>
          <PencilIcon />
          Modifier
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
          <BanIcon />
          Annuler la facture
        </DropdownMenuItem>
      </RowMenu>

      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader className="border-b border-border">
            <SheetTitle className="text-[15px]">Modifier la facture</SheetTitle>
            <SheetDescription className="text-[12px]">
              Corrige ce qui a été mal saisi. Les revenus déjà encaissés dessus gardent leur lien.
            </SheetDescription>
          </SheetHeader>
          <div className="p-4">
            <InvoiceForm actors={actors} draft={invoice.draft} today={today} />
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Annuler cette facture ?</AlertDialogTitle>
            <AlertDialogDescription>
              {label}. Elle quitte les factures en attente et garde ses dates. Une facture déjà encaissée,
              même en partie, ne s’annule pas : détache d’abord les revenus liés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {state.error && <p className="text-xs text-destructive">{state.error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Revenir</AlertDialogCancel>
            <form action={cancel}>
              <input type="hidden" name="invoiceId" value={invoice.invoiceId} />
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? '…' : 'Annuler la facture'}
              </Button>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
