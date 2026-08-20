'use client'

import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
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
  /** Origin the form must not silently break (échéance, ajustement, avance). */
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
  const [advanceOpen, setAdvanceOpen] = useState(false)

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
          <AmountInput name="amount" placeholder="12,50" defaultValue={draft?.amount ?? ''} />
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

      {type === 'expense' && !editing && (
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
            <div className="mt-2">
              <TextField
                name="expectedRefundFrom"
                label="Qui doit rembourser ?"
                list="actors-list"
                placeholder="Alex"
                autoComplete="off"
              />
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
