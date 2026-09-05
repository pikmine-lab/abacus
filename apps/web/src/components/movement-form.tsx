'use client'

import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { CurrencySelect } from '@/components/currency-select'
import {
  ActionForm,
  DateField,
  Field,
  FormSelect,
  MonthField,
  SubmitButton,
  TextField,
} from '@/components/forms'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { correctMovementAction, declareMovementAction } from '@/lib/actions'
import { eur } from '@/lib/utils'

interface Option {
  id: string
  name: string
}
/**
 * An activity, with what its regime does to an expense filed under it: only a
 * business activity registered for VAT reclaims any, so only one of them lets
 * an expense say how much of it was VAT.
 */
export interface ActivityOption extends Option {
  vatRegistered?: boolean
  /** The rate its purchases usually bear, as a percentage, when it has one. */
  defaultVatRate?: number
}
interface Advance {
  id: string
  happenedOn: string
  amount: number
  remaining: number
}
/** An invoice still awaiting payment, offered to an income from its client. */
export interface OpenInvoiceOption {
  id: string
  client: string
  label: string
}

const TYPES = [
  { value: 'expense', label: 'Dépense' },
  { value: 'income', label: 'Revenu' },
  { value: 'transfer', label: 'Virement' },
] as const

/** An existing movement being corrected, flattened for the form fields. */
export interface MovementDraft {
  id: string
  type: 'expense' | 'income' | 'transfer'
  happenedOn: string
  amount: string
  /** Declared in a foreign currency: amount above is its EUR counter-value. */
  originalAmount?: string
  originalCurrency?: string
  accountId: string
  toAccountId?: string
  actorName?: string
  categoryId?: string
  activityId?: string
  note?: string
  /** "YYYY-MM" when this movement is about a month other than its date's. */
  accrualMonth?: string
  /** Left out of every analysis, while still counted in the balances. */
  ghost?: boolean
  /** Advance carried by this expense: who owes, and the share expected back. */
  refundFromActorName?: string
  expectedRefundAmount?: number
  /** The VAT stated inside the amount, when the activity reclaims it. */
  vatAmount?: string
  /** Origin the form must not silently break (échéance, ajustement). */
  origin?: string
}

export function MovementForm({
  accounts,
  actors,
  categories,
  activities,
  advances,
  invoices = [],
  today,
  draft,
}: {
  accounts: Option[]
  actors: Option[]
  categories: Option[]
  activities: ActivityOption[]
  advances: Advance[]
  /** Open invoices, so an income from a client can say which one it pays. */
  invoices?: OpenInvoiceOption[]
  today: string
  /** Present when correcting an existing movement instead of declaring one. */
  draft?: MovementDraft
}) {
  const [type, setType] = useState<'expense' | 'income' | 'transfer'>(draft?.type ?? 'expense')
  // The counterparty, watched so an income from a client with open invoices
  // is offered the one it pays.
  const [actorName, setActorName] = useState(draft?.actorName ?? '')
  const payable = invoices.filter((i) => i.client.toLowerCase() === actorName.trim().toLowerCase())
  // The activity is watched because its regime decides whether an expense
  // says how much of it was VAT: only one registered for VAT reclaims any.
  const [activityId, setActivityId] = useState(draft?.activityId ?? '')
  const vatActivity = activities.find((a) => a.id === activityId && a.vatRegistered)
  const [advanceOpen, setAdvanceOpen] = useState(draft?.refundFromActorName !== undefined)
  const [monthOpen, setMonthOpen] = useState(draft?.accrualMonth !== undefined)
  // The month the movement is about is stated against the month of its date,
  // so the date is watched here: moving the date moves what "no attachment"
  // means, and an attached month stays where it was put.
  const [day, setDay] = useState(draft?.happenedOn ?? today)
  const [month, setMonth] = useState<string | null>(draft?.accrualMonth ?? null)
  // The expense amount, watched because the expected share reads as a
  // percentage of it, live.
  const [amount, setAmount] = useState(draft?.originalAmount ?? draft?.amount ?? '')
  const [currency, setCurrency] = useState(draft?.originalCurrency ?? 'EUR')
  // What hit the account when the statement says it; the share reads on it.
  const [eurAmount, setEurAmount] = useState(draft?.originalCurrency ? (draft?.amount ?? '') : '')
  // Editing the paid amount voids the prefilled statement euros.
  const [eurCleared, setEurCleared] = useState(false)

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }))
  const editing = draft !== undefined
  const foreign = type !== 'transfer' && currency !== 'EUR'

  return (
    <ActionForm
      action={editing ? correctMovementAction : declareMovementAction}
      successLabel={editing ? 'Mouvement corrigé' : 'Mouvement déclaré'}
      onSuccess={() => {
        // A success remounts the fields (they clear), but this state lives
        // above the remount: left alone it would keep showing the euros field
        // while the cleared select says EUR.
        setActorName('')
        setActivityId('')
        setAmount('')
        setCurrency('EUR')
        setEurAmount('')
        setEurCleared(false)
        setMonthOpen(false)
        setDay(today)
        setMonth(null)
      }}
    >
      <input type="hidden" name="type" value={type} />
      {draft && <input type="hidden" name="movementId" value={draft.id} />}
      {draft?.origin && (
        <p className="rounded-md border border-border bg-secondary/40 px-2.5 py-2 text-[11.5px] text-muted-foreground">
          {draft.origin} Corriger le montant ou la date ici ne défait pas ce lien.
        </p>
      )}
      <Tabs
        value={type}
        onValueChange={(v) => {
          const next = v as typeof type
          setType(next)
          // A transfer moves euros: editing a foreign movement, the amount
          // field flips to the EUR counter-value (and back to the paid amount).
          if (editing && draft?.originalCurrency)
            setAmount(next === 'transfer' ? draft.amount : (draft.originalAmount ?? draft.amount))
        }}
      >
        <TabsList className="w-full">
          {TYPES.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" name="date">
          <DateField name="date" defaultValue={draft?.happenedOn ?? today} onValueChange={setDay} />
        </Field>
        <Field label="Montant" name="amount">
          <div className="flex gap-2">
            <AmountInput
              // The key remounts the field when the unit it shows changes.
              key={
                editing && draft?.originalCurrency
                  ? `amount-${type === 'transfer' ? 'eur' : 'paid'}`
                  : 'amount'
              }
              name="amount"
              placeholder="12,50"
              defaultValue={
                type === 'transfer' ? (draft?.amount ?? '') : (draft?.originalAmount ?? draft?.amount ?? '')
              }
              onValueChange={(value) => {
                setAmount(value)
                // The paid amount moved: the prefilled euros stop applying,
                // the day's rate takes over unless retyped from the statement.
                if (editing && draft?.originalCurrency && Number(value) !== Number(draft.originalAmount)) {
                  setEurCleared(true)
                  setEurAmount('')
                }
              }}
            />
            {type !== 'transfer' && (
              <CurrencySelect value={currency} onValueChange={(v) => setCurrency(v || 'EUR')} />
            )}
          </div>
        </Field>
      </div>

      {foreign && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={`En euros (${type === 'income' ? 'crédités' : 'débités'})`} name="eurAmount">
            <AmountInput
              key={eurCleared ? 'eur-cleared' : 'eur'}
              name="eurAmount"
              placeholder="au cours du jour"
              defaultValue={!eurCleared && draft?.originalCurrency ? (draft?.amount ?? '') : ''}
              onValueChange={setEurAmount}
            />
          </Field>
        </div>
      )}

      {type !== 'transfer' && (
        <div>
          <button
            type="button"
            onClick={() => setMonthOpen((v) => !v)}
            className="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:underline"
            aria-expanded={monthOpen}
          >
            {monthOpen ? '− Rattacher à un autre mois' : '+ Rattacher à un autre mois'}
          </button>
          {/* Closing the block detaches the movement: the field stops being
              submitted, and the action reads an absent month as "none". The
              open state is the attachment, exactly as it is for an advance. */}
          {monthOpen && (
            <Field className="mt-2" label="Compté dans le mois de" name="accrualMonth">
              <MonthField name="accrualMonth" anchor={day} value={month} onValueChange={setMonth} />
            </Field>
          )}
        </div>
      )}

      <Field label={type === 'income' ? 'Compte crédité' : 'Compte débité'} name="accountId">
        <FormSelect
          name="accountId"
          placeholder="Choisir un compte"
          options={accountOptions}
          defaultValue={draft?.accountId ?? ''}
        />
      </Field>

      {type === 'transfer' ? (
        <Field label="Vers le compte" name="toAccountId">
          <FormSelect
            name="toAccountId"
            required
            placeholder="Choisir un compte"
            options={accountOptions}
            defaultValue={draft?.toAccountId ?? ''}
          />
        </Field>
      ) : (
        <>
          <TextField
            name="actor"
            label={type === 'expense' ? 'Payé à (acteur)' : 'Reçu de (acteur)'}
            list="actors-list"
            placeholder="Carrefour, ACME, URSSAF…"
            autoComplete="off"
            defaultValue={draft?.actorName ?? ''}
            onValueChange={setActorName}
          />
          <datalist id="actors-list">
            {actors.map((a) => (
              <option key={a.id} value={a.name} />
            ))}
          </datalist>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Catégorie">
              <FormSelect
                name="categoryId"
                noneLabel="(aucune)"
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
                defaultValue={draft?.categoryId ?? ''}
              />
            </Field>
            <Field label="Activité">
              <FormSelect
                name="activityId"
                noneLabel={editing ? '(aucune)' : 'héritée de l’acteur'}
                options={activities.map((a) => ({ value: a.id, label: a.name }))}
                defaultValue={draft?.activityId ?? ''}
                onValueChange={setActivityId}
              />
            </Field>
          </div>

          {/* Only on an expense of an activity that reclaims VAT: what a
              purchase bore comes off what was collected, and nowhere else does
              anything ever read it. An activity left to the actor shows no
              field, because nothing here knows yet which one it will be. */}
          {type === 'expense' && vatActivity && (
            <VatField
              amount={Number(foreign ? eurAmount : amount)}
              // A correction shows what was declared and proposes nothing: the
              // panel rebuilds the movement whole, so a proposal here would
              // write a VAT the receipt never stated.
              rate={editing ? undefined : vatActivity.defaultVatRate}
              defaultValue={draft?.vatAmount}
            />
          )}
        </>
      )}

      <TextField name="note" label="Note (optionnelle)" defaultValue={draft?.note ?? ''} />

      {/* A binary attribute, so a checkbox rather than a foldable block: there
          is nothing to fill in behind it. Absent on a transfer, which counts
          in no total to begin with and which the service refuses to mark. */}
      {type !== 'transfer' && (
        <Label className="flex items-start gap-2 text-[11.5px] font-normal text-muted-foreground">
          <Checkbox name="ghost" defaultChecked={draft?.ghost} className="mt-px" />
          <span>
            mouvement fantôme : compté dans les soldes, dans aucune analyse (sinistre remboursé, don,
            régularisation)
          </span>
        </Label>
      )}

      {type === 'expense' && (
        <div>
          <button
            type="button"
            onClick={() => setAdvanceOpen((v) => !v)}
            className="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:underline"
            aria-expanded={advanceOpen}
          >
            {advanceOpen ? '− Avance pour quelqu’un' : '+ Avance pour quelqu’un (à rembourser)'}
          </button>
          {advanceOpen && (
            <div className="mt-2 flex flex-col gap-3">
              <TextField
                name="expectedRefundFrom"
                label="Qui doit rembourser ?"
                list="actors-list"
                placeholder="Alex"
                autoComplete="off"
                defaultValue={draft?.refundFromActorName ?? ''}
              />
              <RefundShare
                expense={Number(foreign ? eurAmount : amount)}
                defaultAmount={draft?.expectedRefundAmount}
              />
              {!editing && (
                <Label className="flex items-center gap-2 text-[11.5px] font-normal text-muted-foreground">
                  <Checkbox name="refundedNow" />
                  <span>déjà remboursé : écrire aussi le revenu</span>
                </Label>
              )}
            </div>
          )}
        </div>
      )}

      {/* Declaration only: a correction never touches the link an income has
          with the invoice it paid, as it never touches the other origins. */}
      {type === 'income' && !editing && payable.length > 0 && (
        <Field label="Règle la facture (optionnel)">
          <FormSelect
            name="invoiceId"
            noneLabel="non"
            options={payable.map((invoice) => ({ value: invoice.id, label: invoice.label }))}
          />
        </Field>
      )}

      {type === 'income' && !editing && advances.length > 0 && (
        <Field label="Rembourse une avance (optionnel)">
          <FormSelect
            name="refundsMovementId"
            noneLabel="non"
            options={advances.map((adv) => ({
              value: adv.id,
              label: `${adv.happenedOn} · ${eur(adv.amount)} (reste ${eur(adv.remaining)})`,
            }))}
          />
        </Field>
      )}

      <SubmitButton className="self-start">{editing ? 'Enregistrer' : 'Déclarer'}</SubmitButton>
    </ActionForm>
  )
}

/**
 * The VAT inside an expense of a registered activity: an amount, because that
 * is the figure a receipt prints and the figure a return deducts, proposed
 * from the rate the activity's purchases usually bear.
 *
 * The proposal follows the amount as long as nothing has been typed here; the
 * first keystroke makes the field the truth, and emptying it says this
 * purchase bore none. A receipt that departs from the usual rate is the
 * ordinary case, not the exception, so what is typed is never rewritten.
 */
function VatField({ amount, rate, defaultValue }: { amount: number; rate?: number; defaultValue?: string }) {
  const [typed, setTyped] = useState<string | null>(defaultValue ?? null)
  // The rate applies to the amount before VAT, and the amount here includes it.
  const proposed =
    rate !== undefined && rate > 0 && Number.isFinite(amount) && amount > 0
      ? Math.round(((amount * rate) / (100 + rate)) * 100) / 100
      : null
  const cleaned = typed === null ? null : typed.replace(/[\s\u202f\u00a0]/g, '').replace(',', '.')
  const value = cleaned === null ? proposed : cleaned === '' ? null : Number(cleaned)

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="dont TVA (€)" name="vatAmount">
        <input type="hidden" name="vatAmount" value={value !== null && Number.isFinite(value) ? value : ''} />
        <Input
          inputMode="decimal"
          autoComplete="off"
          className="text-right font-mono tabular"
          value={typed ?? (proposed === null ? '' : proposed.toFixed(2).replace('.', ','))}
          onChange={(e) => setTyped(e.target.value)}
        />
      </Field>
    </div>
  )
}

/**
 * The share expected back, in euros or in percent of the expense: paying for
 * four and being owed three quarters is thought in percent, being owed one
 * item on a shared basket is thought in euros. Whichever is typed is the truth
 * and the other follows, so a corrected expense amount never rewrites what the
 * user actually stated.
 *
 * The form always carries euros: a percentage of an amount that later gets
 * corrected would silently move the claim.
 */
function RefundShare({ expense, defaultAmount }: { expense: number; defaultAmount?: number }) {
  const [{ value, unit }, setShare] = useState<{ value: string; unit: 'eur' | 'pct' }>(
    defaultAmount !== undefined
      ? { value: String(defaultAmount).replace('.', ','), unit: 'eur' }
      : { value: '100', unit: 'pct' },
  )

  const typed = Number(value.replace(/[\s\u202f\u00a0]/g, '').replace(',', '.'))
  const usable = Number.isFinite(expense) && expense > 0 && Number.isFinite(typed)
  const euros = unit === 'eur' ? typed : usable ? Math.round(expense * typed) / 100 : Number.NaN
  const percent = unit === 'pct' ? typed : usable ? (typed / expense) * 100 : Number.NaN

  /** The value the user is not editing, without trailing zeros to fight the caret. */
  const mirror = (n: number, decimals: number) =>
    Number.isFinite(n)
      ? n
          .toFixed(decimals)
          .replace(/(\.\d*?)0+$/, '$1')
          .replace(/\.$/, '')
          .replace('.', ',')
      : ''

  return (
    <div className="grid grid-cols-2 gap-3">
      <input type="hidden" name="expectedRefundAmount" value={Number.isFinite(euros) ? euros : ''} />
      <Field label="Part attendue (€)">
        <Input
          inputMode="decimal"
          autoComplete="off"
          className="text-right font-mono tabular"
          value={unit === 'eur' ? value : mirror(euros, 2)}
          onChange={(e) => setShare({ value: e.target.value, unit: 'eur' })}
        />
      </Field>
      <Field label="ou en %">
        <Input
          inputMode="decimal"
          autoComplete="off"
          className="text-right font-mono tabular"
          value={unit === 'pct' ? value : mirror(percent, 1)}
          onChange={(e) => setShare({ value: e.target.value, unit: 'pct' })}
        />
      </Field>
    </div>
  )
}
