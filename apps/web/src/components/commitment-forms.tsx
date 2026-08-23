'use client'

import { useEffect, useRef, useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { CurrencySelect } from '@/components/currency-select'
import { FinancingAmountFields } from '@/components/financing-fields'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import { PeriodField } from '@/components/period-field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  changeCommitmentAccountAction,
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
  activities: Option[]
}

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
  activities,
  defaults,
  beforeCategory,
  afterActivity,
  /** The account has its own dated gesture, so correction leaves it out. */
  withAccount = true,
}: {
  outgoing: boolean
  accounts: Option[]
  actors: Option[]
  categories: Option[]
  activities: Option[]
  defaults?: { actor?: string; accountId?: string; categoryId?: string; activityId?: string }
  /** Sits next to the category, on the row where the first due date belongs. */
  beforeCategory?: React.ReactNode
  /** Sits next to the activity: a lock-in date, where one can exist. */
  afterActivity?: React.ReactNode
  withAccount?: boolean
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
        {withAccount && (
          <Field label={outgoing ? 'Compte prélevé' : 'Compte crédité'} name="accountId">
            <FormSelect
              name="accountId"
              required
              placeholder="Choisir"
              defaultValue={defaults?.accountId}
              options={accounts.map((a) => ({ value: a.id, label: a.name }))}
            />
          </Field>
        )}
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Activité">
          <FormSelect
            name="activityId"
            noneLabel="(perso)"
            defaultValue={defaults?.activityId}
            options={activities.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>
        {afterActivity}
      </div>
    </>
  )
}

export function NewCommitmentForm({
  direction,
  accounts,
  actors,
  categories,
  activities,
  today,
}: {
  direction: 'outgoing' | 'incoming'
  accounts: Option[]
  actors: Option[]
  categories: Option[]
  activities: Option[]
  today: string
}) {
  const [kind, setKind] = useState<'subscription' | 'financing'>('subscription')
  const outgoing = direction === 'outgoing'

  const shared = (options: { withFirstDue: boolean; withLockIn?: boolean }) => (
    <CommitmentIdentityFields
      outgoing={outgoing}
      accounts={accounts}
      actors={actors}
      categories={categories}
      activities={activities}
      beforeCategory={
        options.withFirstDue ? (
          <Field label="Première échéance" name="firstDueOn">
            <DateField name="firstDueOn" defaultValue={today} />
          </Field>
        ) : undefined
      }
      afterActivity={
        options.withLockIn ? (
          <Field label="Engagé jusqu’au (optionnel)">
            <DateField name="engagedUntil" />
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
        {shared({ withFirstDue: true })}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Montant par période" name="amount">
            <div className="flex gap-2">
              <AmountInput name="amount" placeholder="2 400" />
              <CurrencySelect />
            </div>
          </Field>
          <PeriodField defaultValue="month:1" />
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
          {shared({ withFirstDue: true, withLockIn: true })}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Montant par période" name="amount">
              <div className="flex gap-2">
                <AmountInput name="amount" placeholder="15,99" />
                <CurrencySelect />
              </div>
            </Field>
            <PeriodField defaultValue="month:1" />
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
          {shared({ withFirstDue: false })}
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
  kind,
  incoming,
  defaults,
  options,
  onDone,
}: {
  commitmentId: string
  kind: 'subscription' | 'financing'
  incoming: boolean
  defaults: {
    label: string
    actor: string
    categoryId: string
    activityId: string
    period: string
    engagedUntil: string
  }
  options: CommitmentOptions
  onDone?: () => void
}) {
  return (
    <ActionForm action={editCommitmentAction} onSuccess={onDone} successLabel="Engagement corrigé">
      <input type="hidden" name="commitmentId" value={commitmentId} />
      <TextField name="label" label="Nom" defaultValue={defaults.label} />
      <CommitmentIdentityFields
        outgoing={!incoming}
        withAccount={false}
        accounts={options.accounts}
        actors={options.actors}
        categories={options.categories}
        activities={options.activities}
        defaults={defaults}
        afterActivity={
          // A financing ends at its last installment: it has no lock-in to end.
          kind === 'subscription' ? (
            <Field label="Engagé jusqu’au (optionnel)">
              <DateField name="engagedUntil" defaultValue={defaults.engagedUntil || undefined} />
            </Field>
          ) : undefined
        }
      />
      <PeriodField defaultValue={defaults.period} />
      <p className="text-[11.5px] text-faint">
        La correction vaut pour les échéances à venir. Les mouvements déjà déclarés gardent leur acteur : ils
        disent ce qui s’est passé.
      </p>
      <SubmitButton className="self-start">Enregistrer</SubmitButton>
    </ActionForm>
  )
}

/**
 * Moves the debit (or credit) to another account, from a date. Dated because a
 * move is usually known before it takes effect, and because an occurrence
 * confirmed after it must still land on the account the money really left.
 */
export function MoveAccountForm({
  commitmentId,
  incoming,
  accounts,
  currentAccountId,
  today,
  onDone,
}: {
  commitmentId: string
  incoming: boolean
  accounts: Option[]
  currentAccountId: string
  today: string
  onDone?: () => void
}) {
  return (
    <ActionForm action={changeCommitmentAccountAction} onSuccess={onDone} successLabel="Compte changé">
      <input type="hidden" name="commitmentId" value={commitmentId} />
      <Field label={incoming ? 'Nouveau compte crédité' : 'Nouveau compte prélevé'} name="accountId">
        <FormSelect
          name="accountId"
          required
          placeholder="Choisir"
          defaultValue={currentAccountId}
          options={accounts.map((a) => ({ value: a.id, label: a.name }))}
        />
      </Field>
      <Field label="À partir du" name="effectiveOn">
        <DateField name="effectiveOn" defaultValue={today} />
      </Field>
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
