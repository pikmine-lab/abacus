'use client'

import { useState } from 'react'
import { ActionForm, Field, Select, SubmitButton } from '@/components/forms'
import { Input } from '@/components/ui/input'
import { createFinancingAction, createSubscriptionAction, setJudgmentAction } from '@/lib/actions'

interface Option {
  id: string
  name: string
}

export function NewCommitmentForm({
  accounts,
  actors,
  categories,
  today,
}: {
  accounts: Option[]
  actors: Option[]
  categories: Option[]
  today: string
}) {
  const [kind, setKind] = useState<'subscription' | 'financing'>('subscription')

  const shared = (
    <>
      <datalist id="commitment-actors">
        {actors.map((a) => (
          <option key={a.id} value={a.name} />
        ))}
      </datalist>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Acteur (qui prélève)">
          <Input name="actor" required list="commitment-actors" placeholder="Netflix" autoComplete="off" />
        </Field>
        <Field label="Compte prélevé">
          <Select name="accountId" required defaultValue="">
            <option value="" disabled>
              Choisir
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Première échéance">
          <Input type="date" name="firstDueOn" defaultValue={today} required />
        </Field>
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
      </div>
    </>
  )

  return (
    <div>
      <div className="flex rounded-lg border border-border p-0.5 text-[13px]">
        {(
          [
            ['subscription', 'Abonnement / récurrent'],
            ['financing', 'Paiement en X fois'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
            className={`flex-1 cursor-pointer rounded-md py-1.5 transition-colors ${
              kind === value ? 'bg-wash font-semibold text-primary' : 'text-secondary-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {kind === 'subscription' ? (
        <ActionForm action={createSubscriptionAction} className="mt-3">
          <Field label="Nom">
            <Input name="label" required placeholder="Netflix" />
          </Field>
          {shared}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Montant par période (€)">
              <Input name="amount" required inputMode="decimal" placeholder="15,99" />
            </Field>
            <Field label="Périodicité">
              <Select name="periodUnit" defaultValue="month">
                <option value="week">Hebdomadaire</option>
                <option value="month">Mensuelle</option>
                <option value="year">Annuelle</option>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Jugement">
              <Select name="judgment" defaultValue="">
                <option value="">à juger plus tard</option>
                <option value="essential">essentiel</option>
                <option value="reducible">réductible</option>
                <option value="to_cancel">à résilier</option>
              </Select>
            </Field>
            <label className="flex items-end gap-2 pb-2 text-xs text-secondary-foreground">
              <input type="checkbox" name="incoming" className="size-4 accent-(--primary)" />
              revenu récurrent (salaire…)
            </label>
          </div>
          <SubmitButton className="self-start">Créer l’engagement</SubmitButton>
        </ActionForm>
      ) : (
        <ActionForm action={createFinancingAction} className="mt-3">
          <Field label="Ce qui est financé">
            <Input name="label" required placeholder="Canapé en 4x" />
          </Field>
          {shared}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Montant d’une échéance (€)">
              <Input name="installmentAmount" required inputMode="decimal" placeholder="250" />
            </Field>
            <Field label="Nombre d’échéances">
              <Input name="installmentsTotal" required inputMode="numeric" placeholder="4" />
            </Field>
          </div>
          <Field label="Montant total, si différent de N × échéance (frais)">
            <Input name="totalAmount" inputMode="decimal" placeholder="optionnel" />
          </Field>
          <SubmitButton className="self-start">Créer le financement</SubmitButton>
        </ActionForm>
      )}
    </div>
  )
}

export function JudgmentSelect({ commitmentId, value }: { commitmentId: string; value: string | null }) {
  return (
    <form action={setJudgmentAction}>
      <input type="hidden" name="commitmentId" value={commitmentId} />
      <Select
        name="judgment"
        defaultValue={value ?? ''}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-7 w-auto rounded-full border-border px-2 text-[11px]"
        aria-label="Jugement"
      >
        <option value="" disabled>
          à juger
        </option>
        <option value="essential">essentiel</option>
        <option value="reducible">réductible</option>
        <option value="to_cancel">à résilier</option>
      </Select>
    </form>
  )
}
