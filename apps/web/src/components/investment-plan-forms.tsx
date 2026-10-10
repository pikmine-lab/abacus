'use client'

import { useTranslations } from 'next-intl'
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
  const t = useTranslations('investments.plan')
  const w = useTranslations('investments.words')
  const [chosen, setChosen] = useState(options.assets.length > 0)

  return (
    <ActionForm action={createInvestmentPlanAction} successLabel={t('created')}>
      <TextField name="label" label={w('name')} placeholder={t('labelPlaceholder')} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('sourceAccount')} name="accountId">
          <FormSelect
            name="accountId"
            required
            placeholder={w('choose')}
            options={options.accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>
        <Field label={t('targetAccount')} name="targetAccountId">
          <FormSelect
            name="targetAccountId"
            required
            placeholder={w('choose')}
            defaultValue={options.investmentAccounts[0]?.id}
            options={options.investmentAccounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>
      </div>

      <AssetPicker known={options.assets} onChosen={setChosen} />

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('amountPerPeriod')} name="amount">
          <AmountInput name="amount" placeholder="200" />
        </Field>
        <PeriodField defaultValue="month:1" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('firstDueOn')} name="firstDueOn">
          <DateField name="firstDueOn" defaultValue={today} />
        </Field>
        <Field label={t('activity')}>
          <FormSelect
            name="activityId"
            noneLabel={t('personal')}
            options={options.activities.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>
      </div>

      {/* Said here because this is where one expects to type it, and it is the
          one thing the confirmation cannot compute. */}
      <p className="text-[11.5px] text-faint">{t('createNote')}</p>
      <SubmitButton className="self-start" disabled={!chosen}>
        {t('create')}
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
  const t = useTranslations('investments.plan')
  const w = useTranslations('investments.words')
  const current = options.assets.find((a) => a.id === defaults.assetId)
  const [chosen, setChosen] = useState(current !== undefined)

  return (
    <ActionForm action={editCommitmentAction} onSuccess={onDone} successLabel={t('corrected')}>
      <input type="hidden" name="commitmentId" value={commitmentId} />
      {/* Tells the action to read the placement fields, not an actor. */}
      <input type="hidden" name="placement" value="1" />
      <TextField name="label" label={w('name')} defaultValue={defaults.label} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('targetAccount')} name="targetAccountId">
          <FormSelect
            name="targetAccountId"
            required
            defaultValue={defaults.targetAccountId}
            options={options.investmentAccounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>
        <Field label={t('activity')}>
          <FormSelect
            name="activityId"
            noneLabel={t('personal')}
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
      <p className="text-[11.5px] text-faint">{t('editNote')}</p>
      <SubmitButton className="self-start" disabled={!chosen}>
        {w('save')}
      </SubmitButton>
    </ActionForm>
  )
}
