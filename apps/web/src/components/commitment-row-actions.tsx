'use client'

import type { CommitmentKind, Judgment } from '@abacus/core/domain'
import {
  ArrowRightLeftIcon,
  BanIcon,
  BanknoteIcon,
  CalendarClockIcon,
  NotebookPenIcon,
  PencilIcon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useActionState, useEffect, useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import {
  type CommitmentOptions,
  EditCommitmentForm,
  JudgmentNoteForm,
  MoveAccountForm,
} from '@/components/commitment-forms'
import { CurrencySelect } from '@/components/currency-select'
import { FinancingScheduleForm, type ScheduleLine } from '@/components/financing-schedule-form'
import { ActionForm, DateField, Field, FieldErrors, SubmitButton } from '@/components/forms'
import { EditInvestmentPlanForm, type PlacementOptions } from '@/components/investment-plan-forms'
import { RowMenu } from '@/components/row-menu'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cancelCommitmentAction, changePriceAction } from '@/lib/actions'
import { useFormat } from '@/lib/format'

/**
 * Life-cycle actions of a recurring commitment. Changing the amount is
 * historised on purpose: that log is what lets the app say "+40 % in two
 * years". So it happens in a panel that says so, not in a field sitting in
 * the row.
 */
export function CommitmentRowActions({
  commitmentId,
  label,
  amount,
  currency,
  kind,
  incoming,
  accountId,
  accountName,
  schedule,
  today,
  options,
  defaults,
  placement,
  judgment,
}: {
  commitmentId: string
  label: string
  amount: number
  /** The currency it bills in, which the price-change panel can move. */
  currency: string
  kind: CommitmentKind
  incoming: boolean
  /** The account it hits today, which the dated move starts from. */
  accountId: string
  accountName: string
  /** Financings only: the written plan, so it can be revised from here. */
  schedule?: ScheduleLine[]
  today?: string
  /** References the commitment may point at; enables the correction panel. */
  options?: CommitmentOptions
  defaults?: {
    actor: string
    categoryId: string
    activityId: string
    period: string
    engagedUntil: string
    accountId?: string
    cardId?: string
  }
  /**
   * Investment plan only: what its own correction panel needs. Its fields are
   * not the others' (two accounts and an asset, no actor), so it gets its own
   * form rather than options the shared one would have to ignore.
   */
  placement?: {
    options: PlacementOptions
    targetAccountId: string
    assetId: string
  }
  /** Subscriptions only: the judgment as it stands, annotated from the menu. */
  judgment?: { value: Judgment | null; note: string | null }
}) {
  const [pricing, setPricing] = useState(false)
  const [moving, setMoving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [revising, setRevising] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [annotating, setAnnotating] = useState(false)
  const [cancelState, cancel, cancelPending] = useActionState(cancelCommitmentAction, {})

  useEffect(() => {
    if (cancelState.ok) setConfirming(false)
  }, [cancelState.ok])

  const t = useTranslations('recurring.actions')
  const tForm = useTranslations('recurring.form')
  const format = useFormat()
  const placementKind = kind === 'investment_plan'
  const stop = kind === 'financing' ? 'close' : incoming || placementKind ? 'stop' : 'cancel'
  const stopVerb = t(`stop.${stop}`)

  return (
    <>
      <RowMenu label={label}>
        {((options && defaults) || placement) && (
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <PencilIcon />
            {t('edit')}
          </DropdownMenuItem>
        )}
        {(kind === 'subscription' || placementKind) && (
          <DropdownMenuItem onSelect={() => setPricing(true)}>
            <BanknoteIcon />
            {incoming || placementKind ? t('changeAmount') : t('changePrice')}
          </DropdownMenuItem>
        )}
        {judgment && (
          <DropdownMenuItem onSelect={() => setAnnotating(true)}>
            <NotebookPenIcon />
            {t('annotateJudgment')}
          </DropdownMenuItem>
        )}
        {options && today && (
          <DropdownMenuItem onSelect={() => setMoving(true)}>
            <ArrowRightLeftIcon />
            {t('changeAccount')}
          </DropdownMenuItem>
        )}
        {kind === 'financing' && schedule && (
          <DropdownMenuItem onSelect={() => setRevising(true)}>
            <CalendarClockIcon />
            {t('reviseSchedule')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
          <BanIcon />
          {stopVerb}
        </DropdownMenuItem>
      </RowMenu>

      <Dialog open={pricing} onOpenChange={setPricing}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{label}</DialogTitle>
            <DialogDescription className="text-[12px]">
              {t('priceDescription', {
                amount: currency === 'EUR' ? format.eur(amount, 2) : format.money(amount, currency),
              })}
            </DialogDescription>
          </DialogHeader>
          <ActionForm action={changePriceAction} onSuccess={() => setPricing(false)}>
            <input type="hidden" name="commitmentId" value={commitmentId} />
            <Field label={incoming || placementKind ? t('newAmount') : t('newPrice')} name="amount">
              <div className="flex gap-2">
                <AmountInput name="amount" defaultValue={amount.toFixed(2)} />
                {/* A placement is in euros: an operation is not multi-currency,
                    so there is no other currency to offer. */}
                {!placementKind && <CurrencySelect defaultValue={currency} />}
              </div>
            </Field>
            <Field label={tForm('effectiveOn')} name="effectiveOn" className="w-44">
              <DateField name="effectiveOn" defaultValue={today} />
            </Field>
            <SubmitButton className="self-start">{tForm('save')}</SubmitButton>
          </ActionForm>
        </DialogContent>
      </Dialog>

      {judgment && (
        <Dialog open={annotating} onOpenChange={setAnnotating}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-[15px]">{label}</DialogTitle>
              <DialogDescription className="text-[12px]">{t('annotateDescription')}</DialogDescription>
            </DialogHeader>
            <JudgmentNoteForm
              commitmentId={commitmentId}
              judgment={judgment.value}
              note={judgment.note}
              onDone={() => setAnnotating(false)}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Dated on purpose: a move is usually known before it happens, and an
          occurrence confirmed after it left the account that was right then. */}
      <Dialog open={moving} onOpenChange={setMoving}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{label}</DialogTitle>
            <DialogDescription className="text-[12px]">
              {t(incoming ? 'moveIncoming' : 'moveOutgoing', { account: accountName })}
            </DialogDescription>
          </DialogHeader>
          {options && today && (
            <MoveAccountForm
              commitmentId={commitmentId}
              incoming={incoming}
              accounts={options.accounts}
              currentAccountId={accountId}
              today={today}
              onDone={() => setMoving(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader className="border-b border-border">
            <SheetTitle className="text-[15px]">{label}</SheetTitle>
            <SheetDescription className="text-[12px]">
              {placementKind ? t('editPlacement') : t('editCommitment')}
            </SheetDescription>
          </SheetHeader>
          <div className="p-4">
            {placement && defaults ? (
              <EditInvestmentPlanForm
                commitmentId={commitmentId}
                defaults={{
                  label,
                  period: defaults.period,
                  activityId: defaults.activityId,
                  targetAccountId: placement.targetAccountId,
                  assetId: placement.assetId,
                }}
                options={placement.options}
                onDone={() => setEditing(false)}
              />
            ) : (
              options &&
              defaults &&
              kind !== 'investment_plan' && (
                <EditCommitmentForm
                  commitmentId={commitmentId}
                  kind={kind}
                  incoming={incoming}
                  defaults={{ label, ...defaults }}
                  options={options}
                  onDone={() => setEditing(false)}
                />
              )
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* A plan has as many rows as it has installments: it needs the panel's
          height, not a dialog's, and the row stays visible behind it. */}
      <Sheet open={revising} onOpenChange={setRevising}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader className="border-b border-border">
            <SheetTitle className="text-[15px]">{label}</SheetTitle>
            <SheetDescription className="text-[12px]">{t('reviseDescription')}</SheetDescription>
          </SheetHeader>
          <div className="p-4">
            {schedule && (
              <FinancingScheduleForm
                commitmentId={commitmentId}
                installments={schedule}
                currency={currency}
                today={today ?? ''}
                onDone={() => setRevising(false)}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`stopTitle.${stop}`, { label })}</AlertDialogTitle>
            <AlertDialogDescription>{t('stopDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          {/* Dated: a cancellation with notice ends on the day the notice runs out. */}
          <form id={`stop-${commitmentId}`} action={cancel}>
            <input type="hidden" name="commitmentId" value={commitmentId} />
            <FieldErrors.Provider value={cancelState.fields}>
              <Field label={t('stopOn')} name="effectiveOn" className="w-44">
                <DateField name="effectiveOn" defaultValue={today} />
              </Field>
            </FieldErrors.Provider>
          </form>
          {cancelState.error && <p className="text-xs text-destructive">{cancelState.error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>{t('dismiss')}</AlertDialogCancel>
            <Button
              type="submit"
              form={`stop-${commitmentId}`}
              variant="destructive"
              disabled={cancelPending}
            >
              {cancelPending ? '…' : stopVerb}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
