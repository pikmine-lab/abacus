'use client'

import { useState } from 'react'
import { ActionForm, DateField, Field, FormSelect, SubmitButton } from '@/components/forms'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { declareMovementAction } from '@/lib/actions'
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

export function MovementForm({
  accounts,
  actors,
  categories,
  activities,
  advances,
  today,
}: {
  accounts: Option[]
  actors: Option[]
  categories: Option[]
  activities: Option[]
  advances: Advance[]
  today: string
}) {
  const [type, setType] = useState<'expense' | 'income' | 'transfer'>('expense')
  const [advanceOpen, setAdvanceOpen] = useState(false)

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }))

  return (
    <ActionForm action={declareMovementAction}>
      <input type="hidden" name="type" value={type} />
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
        <Field label="Date">
          <DateField name="date" defaultValue={today} />
        </Field>
        <Field label="Montant (€)">
          <Input name="amount" required inputMode="decimal" placeholder="12,50" />
        </Field>
      </div>

      <Field label={type === 'income' ? 'Compte crédité' : 'Compte débité'}>
        <FormSelect name="accountId" required placeholder="Choisir un compte" options={accountOptions} />
      </Field>

      {type === 'transfer' ? (
        <Field label="Vers le compte">
          <FormSelect name="toAccountId" required placeholder="Choisir un compte" options={accountOptions} />
        </Field>
      ) : (
        <>
          <Field label={type === 'expense' ? 'Payé à (acteur)' : 'Reçu de (acteur)'}>
            <Input
              name="actor"
              required
              list="actors-list"
              placeholder="Carrefour, ACME, URSSAF…"
              autoComplete="off"
            />
          </Field>
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
              />
            </Field>
            <Field label="Activité">
              <FormSelect
                name="activityId"
                noneLabel="héritée de l’acteur"
                options={activities.map((a) => ({ value: a.id, label: a.name }))}
              />
            </Field>
          </div>
        </>
      )}

      <Field label="Note (optionnelle)">
        <Input name="note" placeholder="" />
      </Field>

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
            <Field label="Qui doit rembourser ?" className="mt-2">
              <Input name="expectedRefundFrom" list="actors-list" placeholder="Alex" autoComplete="off" />
            </Field>
          )}
        </div>
      )}

      {type === 'income' && advances.length > 0 && (
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

      <SubmitButton className="self-start">Déclarer</SubmitButton>
    </ActionForm>
  )
}
