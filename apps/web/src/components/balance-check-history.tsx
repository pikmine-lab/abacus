'use client'

import { PencilIcon, ScaleIcon, Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useActionState, useEffect, useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { correctBalanceCheckAction, deleteBalanceCheckAction, settleCheckGapAction } from '@/lib/actions'
import { useFormat } from '@/lib/format'

export interface CheckEntry {
  id: string
  checkedOn: string
  declared: number
  computed: number
  gap: number
  /** Whether an adjustment movement settled the gap. */
  settled: boolean
  /** What the person wrote when pointing it. */
  note: string | null
}

/** What the settling form offers to attribute and file the adjustment. */
export interface SettleOptions {
  actors: { id: string; name: string }[]
  categories: { id: string; name: string }[]
}

/**
 * What was pointed on an account, and how to repair it. A check is a claim
 * about reality ("the balance was this, that day"), so it is mistypable like
 * any other declaration: the amount, and the day it was read.
 */
export function BalanceCheckHistory({ checks, options }: { checks: CheckEntry[]; options: SettleOptions }) {
  const t = useTranslations('accounts.history')
  if (checks.length === 0) return <p className="text-[13px] text-faint">{t('never')}</p>

  return (
    <div className="flex flex-col divide-y divide-border/70 border-y border-border">
      {checks.map((check) => (
        <CheckRow key={check.id} check={check} options={options} />
      ))}
    </div>
  )
}

function CheckRow({ check, options }: { check: CheckEntry; options: SettleOptions }) {
  const t = useTranslations('accounts')
  const format = useFormat()
  const day = format.date(check.checkedOn)
  const [correcting, setCorrecting] = useState(false)
  const [settling, setSettling] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteState, remove, deletePending] = useActionState(deleteBalanceCheckAction, {})

  useEffect(() => {
    if (deleteState.ok) setDeleting(false)
  }, [deleteState.ok])

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[12.5px]">{day}</span>
        <span className={`text-[11px] ${check.gap === 0 ? 'text-faint' : 'text-destructive'}`}>
          {check.gap === 0 ? t('history.noGap') : t('history.gapOf', { amount: format.eur(check.gap, 2) })}
          {check.settled && ` · ${t('history.settledByAdjustment')}`}
        </span>
        {check.note && (
          <span role="note" className="truncate text-[11px] text-muted-foreground">
            {t('history.note', { note: check.note })}
          </span>
        )}
      </div>
      <div className="ml-auto flex shrink-0 flex-col items-end gap-0.5">
        <span className="font-mono text-[12.5px] tabular">{format.eur(check.declared, 2)}</span>
        <span className="font-mono text-[11px] text-faint tabular">
          {t('history.computed', { amount: format.eur(check.computed, 2) })}
        </span>
      </div>
      <RowMenu label={t('history.rowLabel', { date: day })}>
        <DropdownMenuItem onSelect={() => setCorrecting(true)}>
          <PencilIcon />
          {t('actions.correct')}
        </DropdownMenuItem>
        {check.gap !== 0 && !check.settled && (
          <DropdownMenuItem onSelect={() => setSettling(true)}>
            <ScaleIcon />
            {t('settle.title')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
          <Trash2Icon />
          {t('actions.delete')}
        </DropdownMenuItem>
      </RowMenu>

      <Dialog open={correcting} onOpenChange={setCorrecting}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{t('history.correctTitle', { date: day })}</DialogTitle>
            <DialogDescription className="text-[12px]">
              {t('history.correctDescription')}
              {check.settled && ` ${t('history.correctSettled')}`}
            </DialogDescription>
          </DialogHeader>
          <ActionForm action={correctBalanceCheckAction} onSuccess={() => setCorrecting(false)}>
            <input type="hidden" name="checkId" value={check.id} />
            <Field label={t('fields.realBalance')} name="balance">
              <AmountInput name="balance" defaultValue={check.declared.toFixed(2)} />
            </Field>
            <Field label={t('history.readOn')} name="checkedOn">
              <DateField name="checkedOn" defaultValue={check.checkedOn} />
            </Field>
            <TextField
              name="note"
              label={t('fields.note')}
              defaultValue={check.note ?? ''}
              autoComplete="off"
            />
            <SubmitButton className="self-start">{t('actions.save')}</SubmitButton>
          </ActionForm>
        </DialogContent>
      </Dialog>

      <Dialog open={settling} onOpenChange={setSettling}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{t('settle.title')}</DialogTitle>
            <DialogDescription className="text-[12px]">
              {t(check.gap < 0 ? 'settle.missingOut' : 'settle.missingIn', {
                amount: format.eur(Math.abs(check.gap), 2),
                date: day,
              })}{' '}
              {t('settle.explain')}
            </DialogDescription>
          </DialogHeader>
          <ActionForm
            action={settleCheckGapAction}
            onSuccess={() => setSettling(false)}
            successLabel={t('settle.success')}
          >
            <input type="hidden" name="checkId" value={check.id} />
            <datalist id={`settle-actors-${check.id}`}>
              {options.actors.map((a) => (
                <option key={a.id} value={a.name} />
              ))}
            </datalist>
            <TextField
              name="actor"
              label={t('settle.attributedTo')}
              list={`settle-actors-${check.id}`}
              placeholder={t('settle.unknown')}
              autoComplete="off"
            />
            <Field label={t('settle.category')}>
              <FormSelect
                name="categoryId"
                noneLabel={t('settle.noCategory')}
                options={options.categories.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
            <TextField name="note" label={t('settle.note')} defaultValue={t('settle.noteDefault')} />
            {/* The question the app cannot answer for the user: an écart that
                stands for forgotten entries belongs in the analysis, one that
                explains nothing does not. Unchecked by default, because the
                first case is the ordinary one. */}
            <Label className="flex items-start gap-2 text-[11.5px] font-normal text-muted-foreground">
              <Checkbox name="ghost" className="mt-px" />
              <span>{t('settle.ghost')}</span>
            </Label>
            <SubmitButton className="self-start">{t('settle.submit')}</SubmitButton>
          </ActionForm>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('history.deleteTitle', { date: day })}</AlertDialogTitle>
            <AlertDialogDescription>
              {check.settled ? t('history.deleteSettled') : t('history.deleteUnsettled')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteState.error && <p className="text-xs text-destructive">{deleteState.error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <form action={remove}>
              <input type="hidden" name="checkId" value={check.id} />
              <Button type="submit" variant="destructive" disabled={deletePending}>
                {deletePending ? '…' : t('actions.delete')}
              </Button>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
