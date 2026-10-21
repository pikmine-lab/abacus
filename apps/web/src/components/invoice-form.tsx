'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { CurrencySelect } from '@/components/currency-select'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import { Input } from '@/components/ui/input'
import { correctInvoiceAction, declareInvoiceAction } from '@/lib/actions'
import { type Format, useFormat } from '@/lib/format'

interface Option {
  id: string
  name: string
}

/** A client with what it does to an invoice, so the panel proposes its figures. */
export interface ClientOption extends Option {
  vatRate?: string
  withholdingRate?: string
}

/** An existing invoice being corrected, flattened for the form fields. */
export interface InvoiceDraft {
  id: string
  client: string
  reference?: string
  issuedOn: string
  dueOn?: string
  baseAmount: string
  vatRate: string
  vatAmount: string
  withholdingRate: string
  withholdingAmount: string
  /** The ISO code it is written in. */
  currency: string
  note?: string
}

/** What the user typed on a rate/amount pair, and which of the two it was. */
interface Share {
  value: string
  unit: 'rate' | 'amount'
}

/** What a pair opens on, written the way the interface's language writes a number. */
function initialShare(format: Format, rate?: string, amount?: string): Share {
  if (rate === undefined && amount !== undefined)
    return { value: format.editable(Number(amount), 2), unit: 'amount' }
  return { value: rate !== undefined ? format.editable(Number(rate), 2) : '', unit: 'rate' }
}

/** What was typed in the pair, read with the language's marks; an empty field is zero. */
function typed(format: Format, value: string): number {
  return value.trim() === '' ? 0 : format.parse(value)
}

/** The euros a share means against a base, whichever side was typed. */
function euros(format: Format, share: Share, base: number): number {
  const entered = typed(format, share.value)
  if (!Number.isFinite(entered)) return 0
  if (share.unit === 'amount') return entered
  if (!(Number.isFinite(base) && base > 0)) return 0
  return Math.round(base * entered) / 100
}

/** And the percentage it means, which is what the other field shows. */
function percent(format: Format, share: Share, base: number): number {
  const entered = typed(format, share.value)
  if (share.unit === 'rate') return entered
  if (!(Number.isFinite(base) && base > 0 && Number.isFinite(entered))) return Number.NaN
  return (entered / base) * 100
}

/**
 * Declaring an invoice: what was written on it, nothing more. abacus records
 * what an invoicing tool issued, so no numbering and no document are produced
 * here, and the reference is the one already printed.
 *
 * VAT and withholding each ask for a rate or an amount, two fields that
 * answer each other: a contract is thought in percent, an invoice is read in
 * euros. Whichever is typed is the truth and the other follows, exactly as
 * the expected share of an advance does, so a corrected base never rewrites a
 * figure that was actually printed. The net to receive is shown rather than
 * asked: base + VAT − withholding is what will land on the account, and a
 * field for it would let the two disagree.
 *
 * Naming the client fills those rates with what that client does, and an
 * empty rate is submitted as a zero: the panel then shows exactly what will
 * be recorded, where a blank field silently filled in by a default would show
 * one figure and store another.
 */
export function InvoiceForm({
  activities,
  actors,
  defaults,
  draft,
  today,
}: {
  /** Business activities the invoice can belong to, with the currency each invoices in; absent when correcting. */
  activities?: (Option & { currency: string })[]
  actors: ClientOption[]
  /** What a new invoice opens on: the activity, its own VAT rate and its currency. */
  defaults?: { activityId?: string; vatRate?: string; currency?: string }
  draft?: InvoiceDraft
  today: string
}) {
  const t = useTranslations('activity.invoiceForm')
  const format = useFormat()
  const editing = draft !== undefined
  const [base, setBase] = useState(draft?.baseAmount ?? '')
  // Both pairs live here rather than in the field: the net to receive is made
  // of all three figures, and it moves when the base moves too.
  const [vat, setVat] = useState<Share>(
    initialShare(format, draft?.vatRate ?? defaults?.vatRate, draft?.vatAmount),
  )
  const [withholding, setWithholding] = useState<Share>(
    initialShare(format, draft?.withholdingRate, draft?.withholdingAmount),
  )
  // The currency the activity invoices in unless the invoice says otherwise,
  // which is the rule of the service when none is given.
  const defaultCurrency = draft?.currency ?? defaults?.currency ?? 'EUR'
  const [currency, setCurrency] = useState(defaultCurrency)
  const inCurrency = (value: number) =>
    currency === 'EUR' ? format.eur(value, 2) : format.money(value, currency, 2)

  // The base comes from AmountInput as a machine value ("1234.50").
  const baseAmount = Number(base)
  const vatAmount = euros(format, vat, baseAmount)
  const withheldAmount = euros(format, withholding, baseAmount)
  const net = baseAmount + vatAmount - withheldAmount

  return (
    <ActionForm
      action={editing ? correctInvoiceAction : declareInvoiceAction}
      successLabel={editing ? t('corrected') : t('recorded')}
      onSuccess={() => {
        setBase('')
        setVat(initialShare(format, defaults?.vatRate))
        setWithholding(initialShare(format))
        setCurrency(defaultCurrency)
      }}
    >
      {editing && <input type="hidden" name="invoiceId" value={draft.id} />}

      {!editing &&
        (activities && activities.length > 1 ? (
          <Field label={t('activity')} name="activityId">
            <FormSelect
              name="activityId"
              placeholder={t('activityPlaceholder')}
              options={activities.map((a) => ({ value: a.id, label: a.name }))}
              defaultValue={defaults?.activityId ?? ''}
              onValueChange={(id) => {
                const chosen = activities.find((a) => a.id === id)
                if (chosen) setCurrency(chosen.currency)
              }}
            />
          </Field>
        ) : (
          <input type="hidden" name="activityId" value={defaults?.activityId ?? ''} />
        ))}

      <TextField
        name="client"
        label={t('client')}
        list="invoice-clients"
        placeholder={t('clientPlaceholder')}
        autoComplete="off"
        defaultValue={draft?.client ?? ''}
        onValueChange={(name) => {
          // A reaction to the input, not an effect: naming a known client
          // brings its rates in, and a later edit of them wins until another
          // client is named.
          const known = actors.find((a) => a.name.toLowerCase() === name.trim().toLowerCase())
          if (!known) return
          setVat(initialShare(format, known.vatRate ?? defaults?.vatRate))
          setWithholding(initialShare(format, known.withholdingRate))
        }}
      />
      <datalist id="invoice-clients">
        {actors.map((a) => (
          <option key={a.id} value={a.name} />
        ))}
      </datalist>

      {/* Stacked on a phone: the base shares its half with the currency, and
          a half of a phone is too narrow for an amount beside a code. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          name="reference"
          label={t('reference')}
          placeholder="F-2026-014"
          autoComplete="off"
          defaultValue={draft?.reference ?? ''}
        />
        <Field label={t('base')} name="baseAmount">
          {/* The stored value, not the live one: a success remounts the form,
              and a live default would restore what was just submitted. The
              currency qualifies the amount, so it sits beside it. */}
          <div className="flex gap-2">
            <AmountInput
              name="baseAmount"
              placeholder={t('basePlaceholder')}
              defaultValue={draft?.baseAmount ?? ''}
              onValueChange={setBase}
            />
            <CurrencySelect value={currency} onValueChange={setCurrency} />
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('issuedOn')} name="issuedOn">
          <DateField name="issuedOn" defaultValue={draft?.issuedOn ?? today} />
        </Field>
        <Field label={t('dueOn')} name="dueOn">
          <DateField name="dueOn" defaultValue={draft?.dueOn} />
        </Field>
      </div>

      <RateAndAmount
        legend={t('vat')}
        rateName="vatRate"
        amountName="vatAmount"
        base={baseAmount}
        unit={currency}
        share={vat}
        onChange={setVat}
      />
      <RateAndAmount
        legend={t('withholding')}
        rateName="withholdingRate"
        amountName="withholdingAmount"
        base={baseAmount}
        unit={currency}
        share={withholding}
        onChange={setWithholding}
      />

      {baseAmount > 0 && (
        <p className="text-[12px] text-muted-foreground">
          {t.rich('receivable', {
            amount: inCurrency(net),
            value: (chunks) => <span className="font-mono tabular text-foreground">{chunks}</span>,
          })}
        </p>
      )}

      <TextField name="note" label={t('note')} defaultValue={draft?.note ?? ''} />

      <SubmitButton className="self-start">{editing ? t('save') : t('submit')}</SubmitButton>
    </ActionForm>
  )
}

/**
 * A rate and its amount against the base. Both travel to the server: the rate
 * says what this client does, the amount is what the invoice asked for.
 */
function RateAndAmount({
  legend,
  rateName,
  amountName,
  base,
  unit,
  share,
  onChange,
}: {
  legend: string
  rateName: string
  amountName: string
  base: number
  /** The currency the amounts are in, which the amount field names. */
  unit: string
  share: Share
  onChange: (share: Share) => void
}) {
  const t = useTranslations('activity.invoiceForm')
  const format = useFormat()
  const empty = share.value.trim() === ''
  const rate = percent(format, share, base)
  const amount = euros(format, share, base)
  // The mirrored field stays empty until it means something: a zero shown
  // under an empty base reads as "no VAT" while nothing has been typed.
  const mirrored = empty || !(Number.isFinite(base) && base > 0) ? '' : undefined

  return (
    <fieldset className="grid grid-cols-2 gap-3">
      <legend className="pb-1.5 text-xs text-muted-foreground">{legend}</legend>
      {/* An empty field means zero, not "unstated": what the panel shows is
          what gets recorded. */}
      <input type="hidden" name={rateName} value={!empty && Number.isFinite(rate) ? rate : 0} />
      <input type="hidden" name={amountName} value={empty ? 0 : amount} />
      <Field label={t('rate')}>
        <Input
          inputMode="decimal"
          autoComplete="off"
          className="text-right font-mono tabular"
          value={share.unit === 'rate' ? share.value : (mirrored ?? format.editable(rate, 2))}
          onChange={(e) => onChange({ value: e.target.value, unit: 'rate' })}
        />
      </Field>
      <Field label={t('orAmount', { unit: unit === 'EUR' ? '€' : unit })}>
        <Input
          inputMode="decimal"
          autoComplete="off"
          className="text-right font-mono tabular"
          value={share.unit === 'amount' ? share.value : (mirrored ?? format.editable(amount, 2))}
          onChange={(e) => onChange({ value: e.target.value, unit: 'amount' })}
        />
      </Field>
    </fieldset>
  )
}
