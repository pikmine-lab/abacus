'use client'

import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import type { Option } from '@/components/commitment-forms'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import { type AssetEntry, AssetPicker } from '@/components/investment-forms'
import { PeriodField } from '@/components/period-field'
import { createInvestmentPlanAction, editCommitmentAction } from '@/lib/actions'

/** What a scheduled placement can point at: two accounts and an asset. */
export interface PlacementOptions {
  /** Any account the money can leave: a bank account, or a broker's cash. */
  accounts: Option[]
  /** Only these can receive it: a purchase lands on an investment account. */
  investmentAccounts: Option[]
  assets: AssetEntry[]
  activities: Option[]
}

/**
 * Declares a scheduled placement. Two accounts rather than an actor, because
 * the money stays the user's: it goes from one of their accounts to another,
 * and buys there. So no category either.
 *
 * The asset is looked up in the same gesture, like in the operation panel: an
 * unknown fund is created by the submit rather than in an errand beforehand.
 */
export function InvestmentPlanForm({ options, today }: { options: PlacementOptions; today: string }) {
  const [chosen, setChosen] = useState(options.assets.length > 0)

  return (
    <ActionForm action={createInvestmentPlanAction} successLabel="Versement programmé créé">
      <TextField name="label" label="Nom" placeholder="Versement MSCI World" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Compte prélevé" name="accountId">
          <FormSelect
            name="accountId"
            required
            placeholder="Choisir"
            options={options.accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>
        <Field label="Compte investi" name="targetAccountId">
          <FormSelect
            name="targetAccountId"
            required
            placeholder="Choisir"
            defaultValue={options.investmentAccounts[0]?.id}
            options={options.investmentAccounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>
      </div>

      <AssetPicker known={options.assets} onChosen={setChosen} />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Montant par période" name="amount">
          <AmountInput name="amount" placeholder="200" />
        </Field>
        <PeriodField defaultValue="month:1" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Première échéance" name="firstDueOn">
          <DateField name="firstDueOn" defaultValue={today} />
        </Field>
        <Field label="Activité">
          <FormSelect
            name="activityId"
            noneLabel="(perso)"
            options={options.activities.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>
      </div>

      {/* Said here because this is where one expects to type it, and it is the
          one thing the confirmation cannot compute. */}
      <p className="text-[11.5px] text-faint">
        À chaque échéance, le virement et l’achat s’écrivent d’un même geste : il restera à saisir la quantité
        achetée, que le cours d’exécution seul peut dire.
      </p>
      <SubmitButton className="self-start" disabled={!chosen}>
        Créer le versement
      </SubmitButton>
    </ActionForm>
  )
}

/**
 * Corrects a placement. The amount and the account it leaves have their own
 * dated gestures, like on any commitment; what it buys and where it lands are
 * corrections, and the occurrences already confirmed keep what really happened.
 */
export function EditInvestmentPlanForm({
  commitmentId,
  defaults,
  options,
  onDone,
}: {
  commitmentId: string
  defaults: { label: string; period: string; activityId: string; targetAccountId: string; assetId: string }
  options: PlacementOptions
  onDone?: () => void
}) {
  // The picker opens on the asset in force, so leaving the panel untouched
  // sends it back unchanged.
  const current = options.assets.find((a) => a.id === defaults.assetId)
  const [chosen, setChosen] = useState(current !== undefined)

  return (
    <ActionForm action={editCommitmentAction} onSuccess={onDone} successLabel="Versement corrigé">
      <input type="hidden" name="commitmentId" value={commitmentId} />
      {/* Tells the action to read the placement fields, not an actor. */}
      <input type="hidden" name="placement" value="1" />
      <TextField name="label" label="Nom" defaultValue={defaults.label} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Compte investi" name="targetAccountId">
          <FormSelect
            name="targetAccountId"
            required
            defaultValue={defaults.targetAccountId}
            options={options.investmentAccounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>
        <Field label="Activité">
          <FormSelect
            name="activityId"
            noneLabel="(perso)"
            defaultValue={defaults.activityId}
            options={options.activities.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>
      </div>
      <AssetPicker
        known={current ? [current, ...options.assets.filter((a) => a.id !== current.id)] : options.assets}
        onChosen={setChosen}
      />
      <PeriodField defaultValue={defaults.period} />
      <p className="text-[11.5px] text-faint">
        La correction vaut pour les échéances à venir. Les versements déjà confirmés gardent leur compte et
        l’actif acheté : ils disent ce qui s’est passé.
      </p>
      <SubmitButton className="self-start" disabled={!chosen}>
        Enregistrer
      </SubmitButton>
    </ActionForm>
  )
}
