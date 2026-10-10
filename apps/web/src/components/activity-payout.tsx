'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { ActionForm, DateField, Field, FormSelect, SubmitButton } from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { declareMovementAction } from '@/lib/actions'
import { useFormat } from '@/lib/format'

interface Option {
  id: string
  name: string
}

/**
 * Paying oneself: a transfer out of the activity's accounts, prefilled with
 * what the statement says is payable and editable, because that figure is an
 * estimate and the decision stays the owner's. It is a movement like any
 * other afterwards, which is what keeps the balances and the balance checks
 * telling the same story.
 *
 * Only accounts outside the activity are offered as a target: a transfer
 * between two of its own accounts moves nothing out of it.
 *
 * The transfer names the activity, because a transfer inherits none from its
 * accounts: out of an account shared with another activity, an untagged one
 * would say nothing about which activity the money left, and would show in
 * neither statement.
 */
export function ActivityPayout({
  activityId,
  amount,
  from,
  to,
  today,
}: {
  activityId: string
  /** What is payable today; zero or less leaves the field empty. */
  amount: number
  /** The activity's own accounts, one of which the money leaves. */
  from: Option[]
  /** Accounts outside the activity, where it lands. */
  to: Option[]
  today: string
}) {
  const t = useTranslations('activity.payout')
  const format = useFormat()
  const [open, setOpen] = useState(false)
  const payable = amount > 0

  if (from.length === 0 || to.length === 0)
    return (
      <p className="text-[11.5px] text-faint">
        {from.length === 0 ? t('noOwnAccount') : t('noOutsideAccount')}
      </p>
    )

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" onClick={() => setOpen(true)}>
        {payable ? t('button', { amount: format.eur(amount) }) : t('buttonEmpty')}
      </Button>
      <p className="text-[11.5px] text-faint">{payable ? t('hint') : t('hintEmpty')}</p>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader className="border-b border-border">
            <SheetTitle className="text-[15px]">{t('title')}</SheetTitle>
            <SheetDescription className="text-[12px]">{t('description')}</SheetDescription>
          </SheetHeader>
          <div className="p-4">
            <ActionForm action={declareMovementAction} successLabel={t('success')}>
              <input type="hidden" name="type" value="transfer" />
              <input type="hidden" name="activityId" value={activityId} />
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('date')} name="date">
                  <DateField name="date" defaultValue={today} />
                </Field>
                <Field label={t('amount')} name="amount">
                  <AmountInput
                    name="amount"
                    placeholder={t('amountPlaceholder')}
                    defaultValue={payable ? amount.toFixed(2) : ''}
                  />
                </Field>
              </div>
              <Field label={t('from')} name="accountId">
                <FormSelect
                  name="accountId"
                  placeholder={t('fromPlaceholder')}
                  options={from.map((a) => ({ value: a.id, label: a.name }))}
                  defaultValue={from[0]?.id ?? ''}
                />
              </Field>
              <Field label={t('to')} name="toAccountId">
                <FormSelect
                  name="toAccountId"
                  placeholder={t('toPlaceholder')}
                  options={to.map((a) => ({ value: a.id, label: a.name }))}
                  defaultValue={to[0]?.id ?? ''}
                />
              </Field>
              <SubmitButton className="self-start">{t('submit')}</SubmitButton>
            </ActionForm>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
