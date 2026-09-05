'use client'

import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import { Input } from '@/components/ui/input'
import { correctInvoiceAction, declareInvoiceAction } from '@/lib/actions'
import { eur } from '@/lib/utils'

interface Option {
  id: string
  name: string
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
  note?: string
}

/** Turns a typed figure into a number, whatever the grouped input wrote. */
function typed(value: string): number {
  return Number(value.replace(/[\s  ]/g, '').replace(',', '.'))
}

/** The value the user is not editing, without trailing zeros to fight the caret. */
function mirror(n: number, decimals: number): string {
  if (!Number.isFinite(n)) return ''
  return n
    .toFixed(decimals)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '')
    .replace('.', ',')
}

/** What the user typed on a rate/amount pair, and which of the two it was. */
interface Share {
  value: string
  unit: 'rate' | 'amount'
}

function initialShare(rate?: string, amount?: string): Share {
  if (rate === undefined && amount !== undefined) return { value: mirror(Number(amount), 2), unit: 'amount' }
  return { value: rate !== undefined ? mirror(Number(rate), 2) : '', unit: 'rate' }
}

/** The euros a share means against a base, whichever side was typed. */
function euros(share: Share, base: number): number {
  const entered = typed(share.value)
  if (!Number.isFinite(entered)) return 0
  if (share.unit === 'amount') return entered
  if (!(Number.isFinite(base) && base > 0)) return 0
  return Math.round(base * entered) / 100
}

/** And the percentage it means, which is what the other field shows. */
function percent(share: Share, base: number): number {
  const entered = typed(share.value)
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
 */
export function InvoiceForm({
  activities,
  actors,
  defaults,
  draft,
  today,
}: {
  /** Business activities the invoice can belong to; absent when correcting. */
  activities?: Option[]
  actors: Option[]
  /** What a new invoice opens on: the activity, and its own VAT rate. */
  defaults?: { activityId?: string; vatRate?: string }
  draft?: InvoiceDraft
  today: string
}) {
  const editing = draft !== undefined
  const [base, setBase] = useState(draft?.baseAmount ?? '')
  // Both pairs live here rather than in the field: the net to receive is made
  // of all three figures, and it moves when the base moves too.
  const [vat, setVat] = useState<Share>(initialShare(draft?.vatRate ?? defaults?.vatRate, draft?.vatAmount))
  const [withholding, setWithholding] = useState<Share>(
    initialShare(draft?.withholdingRate, draft?.withholdingAmount),
  )

  const baseAmount = typed(base)
  const vatAmount = euros(vat, baseAmount)
  const withheldAmount = euros(withholding, baseAmount)
  const net = baseAmount + vatAmount - withheldAmount

  return (
    <ActionForm
      action={editing ? correctInvoiceAction : declareInvoiceAction}
      successLabel={editing ? 'Facture corrigée' : 'Facture enregistrée'}
      onSuccess={() => {
        setBase('')
        setVat(initialShare(defaults?.vatRate))
        setWithholding(initialShare())
      }}
    >
      {editing && <input type="hidden" name="invoiceId" value={draft.id} />}

      {!editing &&
        (activities && activities.length > 1 ? (
          <Field label="Activité" name="activityId">
            <FormSelect
              name="activityId"
              placeholder="Choisir une activité"
              options={activities.map((a) => ({ value: a.id, label: a.name }))}
              defaultValue={defaults?.activityId ?? ''}
            />
          </Field>
        ) : (
          <input type="hidden" name="activityId" value={defaults?.activityId ?? ''} />
        ))}

      <TextField
        name="client"
        label="Client"
        list="invoice-clients"
        placeholder="Nom du client"
        autoComplete="off"
        defaultValue={draft?.client ?? ''}
      />
      <datalist id="invoice-clients">
        {actors.map((a) => (
          <option key={a.id} value={a.name} />
        ))}
      </datalist>

      <div className="grid grid-cols-2 gap-3">
        <TextField
          name="reference"
          label="Référence"
          placeholder="F-2026-014"
          autoComplete="off"
          defaultValue={draft?.reference ?? ''}
        />
        <Field label="Base HT" name="baseAmount">
          <AmountInput name="baseAmount" placeholder="1 200,00" defaultValue={base} onValueChange={setBase} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Émise le" name="issuedOn">
          <DateField name="issuedOn" defaultValue={draft?.issuedOn ?? today} />
        </Field>
        <Field label="Échéance" name="dueOn">
          <DateField name="dueOn" defaultValue={draft?.dueOn} />
        </Field>
      </div>

      <RateAndAmount
        legend="TVA collectée"
        rateName="vatRate"
        amountName="vatAmount"
        base={baseAmount}
        share={vat}
        onChange={setVat}
      />
      <RateAndAmount
        legend="Retenue à la source"
        rateName="withholdingRate"
        amountName="withholdingAmount"
        base={baseAmount}
        share={withholding}
        onChange={setWithholding}
      />

      {baseAmount > 0 && (
        <p className="text-[12px] text-muted-foreground">
          net à recevoir <span className="font-mono tabular text-foreground">{eur(net, 2)}</span>
        </p>
      )}

      <TextField name="note" label="Note (optionnelle)" defaultValue={draft?.note ?? ''} />

      <SubmitButton className="self-start">{editing ? 'Enregistrer' : 'Enregistrer la facture'}</SubmitButton>
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
  share,
  onChange,
}: {
  legend: string
  rateName: string
  amountName: string
  base: number
  share: Share
  onChange: (share: Share) => void
}) {
  const rate = percent(share, base)
  const amount = euros(share, base)
  const empty = share.value.trim() === ''

  return (
    <fieldset className="grid grid-cols-2 gap-3">
      <legend className="pb-1.5 text-xs text-muted-foreground">{legend}</legend>
      <input type="hidden" name={rateName} value={!empty && Number.isFinite(rate) ? rate : ''} />
      <input type="hidden" name={amountName} value={empty ? '' : amount} />
      <Field label="Taux (%)">
        <Input
          inputMode="decimal"
          autoComplete="off"
          className="text-right font-mono tabular"
          value={share.unit === 'rate' ? share.value : mirror(rate, 2)}
          onChange={(e) => onChange({ value: e.target.value, unit: 'rate' })}
        />
      </Field>
      <Field label="ou en €">
        <Input
          inputMode="decimal"
          autoComplete="off"
          className="text-right font-mono tabular"
          value={share.unit === 'amount' ? share.value : mirror(amount, 2)}
          onChange={(e) => onChange({ value: e.target.value, unit: 'amount' })}
        />
      </Field>
    </fieldset>
  )
}
