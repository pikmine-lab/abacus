'use client'

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { CurrencySelect } from '@/components/currency-select'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { correctMovementAction, declareMovementAction } from '@/lib/actions'
import { eur, frMonthLong } from '@/lib/utils'

interface Option {
  id: string
  name: string
}
interface Advance {
  id: string
  happenedOn: string
  amount: number
  remaining: number
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
  /** Advance carried by this expense: who owes, and the share expected back. */
  refundFromActorName?: string
  expectedRefundAmount?: number
  /** Origin the form must not silently break (échéance, ajustement). */
  origin?: string
}

export function MovementForm({
  accounts,
  actors,
  categories,
  activities,
  advances,
  today,
  draft,
}: {
  accounts: Option[]
  actors: Option[]
  categories: Option[]
  activities: Option[]
  advances: Advance[]
  today: string
  /** Present when correcting an existing movement instead of declaring one. */
  draft?: MovementDraft
}) {
  const [type, setType] = useState<'expense' | 'income' | 'transfer'>(draft?.type ?? 'expense')
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
              <MonthStepper day={day} value={month} onChange={setMonth} />
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
              />
            </Field>
          </div>
        </>
      )}

      <TextField name="note" label="Note (optionnelle)" defaultValue={draft?.note ?? ''} />

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

function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split('-').map(Number)
  const total = y! * 12 + (m! - 1) + by
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/**
 * The month a movement is about, stepped from the month of its own date.
 *
 * Not a list of months: a dropdown is the wrong control twice over here. It
 * only holds a value the user has to hunt for, and what is being stated is
 * relative anyway ("that one is for the month before"). NN/g names the month
 * of a date as the textbook case for not using a dropdown, and caps a date
 * dropdown at under ten options; a year of months is seventeen and scrolls.
 * Stepping is one click for the salary and the rent, which is every real case,
 * and it reuses the app's own month idiom (PeriodPicker).
 *
 * The date's own month is the neutral state, and it says so: coming back to it
 * detaches the movement rather than writing a default into the database.
 */
function MonthStepper({
  day,
  value,
  onChange,
}: {
  day: string
  value: string | null
  onChange: (month: string | null) => void
}) {
  const own = day.slice(0, 7)
  const shown = value ?? own
  const step = (by: number) => {
    const next = shiftMonth(shown, by)
    onChange(next === own ? null : next)
  }
  return (
    <>
      <input type="hidden" name="accrualMonth" value={value ?? ''} />
      <div className="flex items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Mois précédent"
          onClick={() => step(-1)}
        >
          <ChevronLeftIcon />
        </Button>
        <span
          aria-live="polite"
          className={`min-w-[8.5rem] text-center text-[13px] ${value ? 'font-medium text-primary' : 'text-muted-foreground'}`}
        >
          {frMonthLong(shown)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Mois suivant"
          onClick={() => step(1)}
        >
          <ChevronRightIcon />
        </Button>
        {!value && <span className="text-[11.5px] text-faint">le mois de la date</span>}
      </div>
    </>
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
