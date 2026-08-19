'use client'

import { useEffect, useRef, useState } from 'react'
import { ActionForm, DateField, Field, FormSelect, SubmitButton } from '@/components/forms'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
          <FormSelect
            name="accountId"
            required
            placeholder="Choisir"
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Première échéance">
          <DateField name="firstDueOn" defaultValue={today} />
        </Field>
        <Field label="Catégorie">
          <FormSelect
            name="categoryId"
            noneLabel="(aucune)"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
      </div>
    </>
  )

  return (
    <div>
      <Tabs value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
        <TabsList className="w-full">
          <TabsTrigger value="subscription">Abonnement / récurrent</TabsTrigger>
          <TabsTrigger value="financing">Paiement en X fois</TabsTrigger>
        </TabsList>
      </Tabs>

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
              <FormSelect
                name="periodUnit"
                defaultValue="month"
                options={[
                  { value: 'week', label: 'Hebdomadaire' },
                  { value: 'month', label: 'Mensuelle' },
                  { value: 'year', label: 'Annuelle' },
                ]}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Jugement">
              <FormSelect
                name="judgment"
                noneLabel="à juger plus tard"
                options={[
                  { value: 'essential', label: 'essentiel' },
                  { value: 'reducible', label: 'réductible' },
                  { value: 'to_cancel', label: 'à résilier' },
                ]}
              />
            </Field>
            <Label className="flex items-end gap-2 pb-2 text-xs font-normal text-muted-foreground">
              <Checkbox name="incoming" />
              revenu récurrent (salaire…)
            </Label>
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
  const formRef = useRef<HTMLFormElement>(null)
  const [judgment, setJudgment] = useState(value ?? '')

  // Submit after render so the hidden select carries the new value.
  useEffect(() => {
    if (judgment && judgment !== (value ?? '')) formRef.current?.requestSubmit()
  }, [judgment, value])

  return (
    <form action={setJudgmentAction} ref={formRef}>
      <input type="hidden" name="commitmentId" value={commitmentId} />
      <Select name="judgment" value={judgment} onValueChange={setJudgment}>
        <SelectTrigger size="sm" className="h-7 rounded-full px-2.5 text-[11px]" aria-label="Jugement">
          <SelectValue placeholder="à juger" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="essential">essentiel</SelectItem>
          <SelectItem value="reducible">réductible</SelectItem>
          <SelectItem value="to_cancel">à résilier</SelectItem>
        </SelectContent>
      </Select>
    </form>
  )
}
