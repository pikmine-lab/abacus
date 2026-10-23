'use client'

import { BanIcon, CalendarClockIcon, CalendarIcon, PencilIcon, SendIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useActionState, useEffect, useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { DateField, Field, FieldErrors, FormSelect, SubmitButton } from '@/components/forms'
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cancelInvoiceAction, remindInvoiceAction, settleInvoiceAction } from '@/lib/actions'
import { useFormat } from '@/lib/format'
import { daysBetween } from '@/lib/utils'

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
  /** The ISO code its amounts are in. */
  currency: string
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
  const t = useTranslations('activity')
  const format = useFormat()
  const [dateOpen, setDateOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [reminding, setReminding] = useState(false)
  const [reminded, remind] = useActionState(remindInvoiceAction, {})
  const late = invoice.dueOn ? daysBetween(invoice.dueOn, today) : 0
  const label = `${invoice.client}${invoice.reference ? ` · ${invoice.reference}` : ''}`

  return (
    <div className="flex flex-wrap items-center gap-2 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium">{label}</p>
        <p className="text-[11px] text-faint">
          {[
            t('outstanding.issuedOn', { date: format.date(invoice.issuedOn) }),
            invoice.dueOn && t('outstanding.dueOn', { date: format.date(invoice.dueOn) }),
            invoice.remindedOn && t('outstanding.remindedOn', { date: format.date(invoice.remindedOn) }),
            invoice.paid > 0 &&
              t('outstanding.alreadyPaid', { amount: format.money(invoice.paid, invoice.currency, 2) }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>

      {/* The state carries its own words: a colour alone would say nothing to
          whoever does not see it. */}
      <span
        className={`shrink-0 text-[11px] ${invoice.overdue ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {invoice.overdue ? t('outstanding.overdue', { days: late }) : t('invoiceState.pending')}
      </span>

      <span className="ml-auto font-mono text-[13px] tabular">
        {format.money(invoice.receivable, invoice.currency, 2)}
      </span>

      <form action={settleInvoiceAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="invoiceId" value={invoice.invoiceId} />
        <input type="hidden" name="back" value={back} />
        <AmountInput
          name="amount"
          defaultValue={invoice.remaining.toFixed(2)}
          className="h-7 w-28 text-[12.5px]"
          aria-label={t('outstanding.amountLabel', { client: invoice.client })}
        />
        <div className="w-40">
          <FormSelect
            name="accountId"
            placeholder={t('outstanding.accountPlaceholder')}
            ariaLabel={t('outstanding.accountLabel', { client: invoice.client })}
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
          {t('outstanding.collected')}
        </Button>
      </form>

      {reminded.error && <p className="text-xs text-destructive">{reminded.error}</p>}
      <RowMenu label={label}>
        <DropdownMenuItem asChild>
          <form action={remind}>
            <input type="hidden" name="invoiceId" value={invoice.invoiceId} />
            <button type="submit" className="flex w-full items-center gap-2">
              <SendIcon />
              {t('outstanding.remindedToday')}
            </button>
          </form>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setReminding(true)}>
          <CalendarClockIcon />
          {t('outstanding.remindedOtherDate')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setDateOpen((v) => !v)}>
          <CalendarIcon />
          {dateOpen ? t('outstanding.collectedToday') : t('outstanding.collectedOtherDate')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setEditing(true)}>
          <PencilIcon />
          {t('outstanding.edit')}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
          <BanIcon />
          {t('outstanding.cancel')}
        </DropdownMenuItem>
      </RowMenu>

      {/* A reminder sent days ago is recorded on its day, so the row says how long ago. */}
      <Dialog open={reminding} onOpenChange={setReminding}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{t('outstanding.remindTitle')}</DialogTitle>
          </DialogHeader>
          <RemindPanel
            invoiceId={invoice.invoiceId}
            label={label}
            today={today}
            onSaved={() => setReminding(false)}
          />
        </DialogContent>
      </Dialog>

      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader className="border-b border-border">
            <SheetTitle className="text-[15px]">{t('outstanding.editTitle')}</SheetTitle>
            <SheetDescription className="text-[12px]">{t('outstanding.editDescription')}</SheetDescription>
          </SheetHeader>
          <div className="p-4">
            <InvoiceForm actors={actors} draft={invoice.draft} today={today} />
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('outstanding.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('outstanding.confirmBody', { label })}</AlertDialogDescription>
          </AlertDialogHeader>
          <CancelPanel invoiceId={invoice.invoiceId} today={today} onCancelled={() => setConfirming(false)} />
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// The panels below hold their own action state and live inside their dialog,
// which unmounts them on close: a refusal does not outlive the panel it was
// made in, and a reopened panel starts clean beside its fresh date.

function RemindPanel({
  invoiceId,
  label,
  today,
  onSaved,
}: {
  invoiceId: string
  label: string
  today: string
  onSaved: () => void
}) {
  const t = useTranslations('activity')
  const [reminded, remind] = useActionState(remindInvoiceAction, {})

  useEffect(() => {
    if (reminded.ok) onSaved()
  }, [reminded.ok, onSaved])

  return (
    <form action={remind} className="flex flex-col gap-3">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <FieldErrors.Provider value={reminded.fields}>
        <Field label={t('outstanding.remindedOnField')} name="remindedOn">
          <DateField name="remindedOn" defaultValue={today} />
        </Field>
      </FieldErrors.Provider>
      {reminded.error && <p className="text-xs text-destructive">{reminded.error}</p>}
      <SubmitButton className="self-start">{t('outstanding.remindSave')}</SubmitButton>
    </form>
  )
}

function CancelPanel({
  invoiceId,
  today,
  onCancelled,
}: {
  invoiceId: string
  today: string
  onCancelled: () => void
}) {
  const t = useTranslations('activity')
  const [state, cancel, pending] = useActionState(cancelInvoiceAction, {})

  // Close on success only: a refused cancellation has a reason to show.
  useEffect(() => {
    if (state.ok) onCancelled()
  }, [state.ok, onCancelled])

  return (
    <>
      <form id={`cancel-${invoiceId}`} action={cancel}>
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <FieldErrors.Provider value={state.fields}>
          <Field label={t('outstanding.cancelledOnField')} name="cancelledOn" className="w-44">
            <DateField name="cancelledOn" defaultValue={today} />
          </Field>
        </FieldErrors.Provider>
      </form>
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel>{t('outstanding.goBack')}</AlertDialogCancel>
        <Button type="submit" form={`cancel-${invoiceId}`} variant="destructive" disabled={pending}>
          {pending ? '…' : t('outstanding.cancel')}
        </Button>
      </AlertDialogFooter>
    </>
  )
}
