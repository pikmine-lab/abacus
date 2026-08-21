'use client'

import { useEffect, useRef, useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { FinancingAmountFields } from '@/components/financing-fields'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  createFinancingAction,
  createSubscriptionAction,
  editCommitmentAction,
  setJudgmentAction,
} from '@/lib/actions'

export interface Option {
  id: string
  name: string
}

/** The references a commitment can point at, for the forms that let it move. */
export interface CommitmentOptions {
  accounts: Option[]
  actors: Option[]
  categories: Option[]
}

const PERIOD_OPTIONS = [
  { value: 'week', label: 'Hebdomadaire' },
  { value: 'month', label: 'Mensuelle' },
  { value: 'year', label: 'Annuelle' },
]

/**
 * Recurring commitments, one form per direction. Money going out and money
 * coming in are not two settings of one thing: an outgoing one can be a
 * financing plan and carries a judgment ("what do I cut?"), an incoming one
 * can be neither.
 */
/**
 * What a commitment says about itself: who bills it, which account it hits,
 * how it is filed. Shared by declaration and correction, because two copies of
 * these fields would drift, and the second one would be the one nobody
 * remembers to fix.
 */
function CommitmentIdentityFields({
  outgoing,
  accounts,
  actors,
  categories,
  defaults,
  beforeCategory,
}: {
  outgoing: boolean
  accounts: Option[]
  actors: Option[]
  categories: Option[]
  defaults?: { actor?: string; accountId?: string; categoryId?: string }
  /** Sits next to the category, on the row where the first due date belongs. */
  beforeCategory?: React.ReactNode
}) {
  return (
    <>
      <datalist id="commitment-actors">
        {actors.map((a) => (
          <option key={a.id} value={a.name} />
        ))}
      </datalist>
      <div className="grid grid-cols-2 gap-3">
        <TextField
          name="actor"
          label={outgoing ? 'Acteur (qui prélève)' : 'Acteur (qui verse)'}
          defaultValue={defaults?.actor ?? ''}
          list="commitment-actors"
          placeholder={outgoing ? 'Netflix' : 'ACME SAS'}
          autoComplete="off"
        />
        <Field label={outgoing ? 'Compte prélevé' : 'Compte crédité'} name="accountId">
          <FormSelect
            name="accountId"
            required
            placeholder="Choisir"
            defaultValue={defaults?.accountId}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {beforeCategory}
        <Field label="Catégorie">
          <FormSelect
            name="categoryId"
            noneLabel="(aucune)"
            defaultValue={defaults?.categoryId}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
      </div>
    </>
  )
}

export function NewCommitmentForm({
  direction,
  accounts,
  actors,
  categories,
  today,
}: {
  direction: 'outgoing' | 'incoming'
  accounts: Option[]
  actors: Option[]
  categories: Option[]
  today: string
}) {
  const [kind, setKind] = useState<'subscription' | 'financing'>('subscription')
  const outgoing = direction === 'outgoing'

  const shared = (withFirstDue: boolean) => (
    <CommitmentIdentityFields
      outgoing={outgoing}
      accounts={accounts}
      actors={actors}
      categories={categories}
      beforeCategory={
        withFirstDue ? (
          <Field label="Première échéance" name="firstDueOn">
            <DateField name="firstDueOn" defaultValue={today} />
          </Field>
        ) : undefined
      }
    />
  )

  if (!outgoing)
    return (
      <ActionForm action={createSubscriptionAction} successLabel="Revenu récurrent créé">
        <input type="hidden" name="direction" value="incoming" />
        <TextField name="label" label="Nom" placeholder="Salaire, loyer perçu…" />
        {shared(true)}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Montant par période (€)" name="amount">
            <AmountInput name="amount" placeholder="2 400" />
          </Field>
          <Field label="Périodicité">
            <FormSelect name="periodUnit" defaultValue="month" options={PERIOD_OPTIONS} />
          </Field>
        </div>
        <SubmitButton className="self-start">Créer</SubmitButton>
      </ActionForm>
    )

  return (
    <div>
      <Tabs value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
        <TabsList className="w-full">
          <TabsTrigger value="subscription">Abonnement</TabsTrigger>
          <TabsTrigger value="financing">Paiement en X fois</TabsTrigger>
        </TabsList>
      </Tabs>

      {kind === 'subscription' ? (
        <ActionForm action={createSubscriptionAction} className="mt-3" successLabel="Abonnement créé">
          <input type="hidden" name="direction" value="outgoing" />
          <TextField name="label" label="Nom" placeholder="Netflix" />
          {shared(true)}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Montant par période (€)" name="amount">
              <AmountInput name="amount" placeholder="15,99" />
            </Field>
            <Field label="Périodicité">
              <FormSelect name="periodUnit" defaultValue="month" options={PERIOD_OPTIONS} />
            </Field>
          </div>
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
          <SubmitButton className="self-start">Créer l’abonnement</SubmitButton>
        </ActionForm>
      ) : (
        <ActionForm action={createFinancingAction} className="mt-3" successLabel="Financement créé">
          <TextField name="label" label="Ce qui est financé" placeholder="Canapé en 4x" />
          {shared(false)}
          <FinancingAmountFields today={today} />
          <SubmitButton className="self-start">Créer le financement</SubmitButton>
        </ActionForm>
      )}
    </div>
  )
}

/**
 * Corrects an existing commitment. The amount is deliberately absent: a price
 * change is dated history and has its own panel, and a financing's installment
 * amount comes from its schedule.
 *
 * The movements already declared are not rewritten: they say what happened, on
 * the account it happened on. The panel says so rather than letting someone
 * discover it afterwards.
 */
export function EditCommitmentForm({
  commitmentId,
  incoming,
  defaults,
  options,
  onDone,
}: {
  commitmentId: string
  incoming: boolean
  defaults: { label: string; actor: string; accountId: string; categoryId: string; periodUnit: string }
  options: CommitmentOptions
  onDone?: () => void
}) {
  return (
    <ActionForm action={editCommitmentAction} onSuccess={onDone} successLabel="Engagement corrigé">
      <input type="hidden" name="commitmentId" value={commitmentId} />
      <TextField name="label" label="Nom" defaultValue={defaults.label} />
      <CommitmentIdentityFields
        outgoing={!incoming}
        accounts={options.accounts}
        actors={options.actors}
        categories={options.categories}
        defaults={defaults}
      />
      <Field label="Périodicité">
        <FormSelect name="periodUnit" defaultValue={defaults.periodUnit} options={PERIOD_OPTIONS} />
      </Field>
      <p className="text-[11.5px] text-faint">
        La correction vaut pour les échéances à venir. Les mouvements déjà déclarés gardent leur compte et
        leur acteur : ils disent ce qui s’est passé.
      </p>
      <SubmitButton className="self-start">Enregistrer</SubmitButton>
    </ActionForm>
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
