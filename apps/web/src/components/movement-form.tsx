'use client'

import { useState } from 'react'
import { ActionForm, Field, Select, SubmitButton } from '@/components/forms'
import { Input } from '@/components/ui/input'
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

  return (
    <ActionForm action={declareMovementAction}>
      <input type="hidden" name="type" value={type} />
      <div className="flex rounded-lg border border-border p-0.5 text-[13px]">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-pressed={type === t.value}
            onClick={() => setType(t.value)}
            className={`flex-1 cursor-pointer rounded-md py-1.5 transition-colors ${
              type === t.value ? 'bg-wash font-semibold text-primary' : 'text-secondary-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <Input type="date" name="date" defaultValue={today} required />
        </Field>
        <Field label="Montant (€)">
          <Input name="amount" required inputMode="decimal" placeholder="12,50" />
        </Field>
      </div>

      <Field label={type === 'income' ? 'Compte crédité' : 'Compte débité'}>
        <Select name="accountId" required defaultValue="">
          <option value="" disabled>
            Choisir un compte
          </option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>

      {type === 'transfer' ? (
        <Field label="Vers le compte">
          <Select name="toAccountId" required defaultValue="">
            <option value="" disabled>
              Choisir un compte
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
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
              <Select name="categoryId" defaultValue="">
                <option value="">(aucune)</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Activité">
              <Select name="activityId" defaultValue="">
                <option value="">héritée de l’acteur</option>
                {activities.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
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
            className="cursor-pointer text-xs text-secondary-foreground underline-offset-2 hover:underline"
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
          <Select name="refundsMovementId" defaultValue="">
            <option value="">non</option>
            {advances.map((adv) => (
              <option key={adv.id} value={adv.id}>
                {adv.happenedOn} · {eur(adv.amount)} (reste {eur(adv.remaining)})
              </option>
            ))}
          </Select>
        </Field>
      )}

      <SubmitButton className="self-start">Déclarer</SubmitButton>
    </ActionForm>
  )
}
