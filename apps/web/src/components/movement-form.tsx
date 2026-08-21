'use client'

import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
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
  accountId: string
  toAccountId?: string
  actorName?: string
  categoryId?: string
  activityId?: string
  note?: string
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
  // The expense amount, watched because the expected share reads as a
  // percentage of it, live.
  const [amount, setAmount] = useState(draft?.amount ?? '')

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }))
  const editing = draft !== undefined

  return (
    <ActionForm
      action={editing ? correctMovementAction : declareMovementAction}
      successLabel={editing ? 'Mouvement corrigé' : 'Mouvement déclaré'}
    >
      <input type="hidden" name="type" value={type} />
      {draft && <input type="hidden" name="movementId" value={draft.id} />}
      {draft?.origin && (
        <p className="rounded-md border border-border bg-secondary/40 px-2.5 py-2 text-[11.5px] text-muted-foreground">
          {draft.origin} Corriger le montant ou la date ici ne défait pas ce lien.
        </p>
      )}
      <Tabs value={type} onValueChange={(v) => setType(v as typeof type)}>
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
          <DateField name="date" defaultValue={draft?.happenedOn ?? today} />
        </Field>
        <Field label="Montant (€)" name="amount">
          <AmountInput
            name="amount"
            placeholder="12,50"
            defaultValue={draft?.amount ?? ''}
            onValueChange={setAmount}
          />
        </Field>
      </div>

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
              <RefundShare expense={Number(amount)} defaultAmount={draft?.expectedRefundAmount} />
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
