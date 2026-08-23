'use client'

import { ArrowRightLeftIcon, BanIcon, BanknoteIcon, CalendarClockIcon, PencilIcon } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { type CommitmentOptions, EditCommitmentForm, MoveAccountForm } from '@/components/commitment-forms'
import { CurrencySelect } from '@/components/currency-select'
import { FinancingScheduleForm, type ScheduleLine } from '@/components/financing-schedule-form'
import { ActionForm, Field, SubmitButton } from '@/components/forms'
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
import { eur, money } from '@/lib/utils'

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
}: {
  commitmentId: string
  label: string
  amount: number
  /** The currency it bills in, which the price-change panel can move. */
  currency: string
  kind: 'subscription' | 'financing'
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
  }
}) {
  const [pricing, setPricing] = useState(false)
  const [moving, setMoving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [revising, setRevising] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [cancelState, cancel, cancelPending] = useActionState(cancelCommitmentAction, {})

  useEffect(() => {
    if (cancelState.ok) setConfirming(false)
  }, [cancelState.ok])

  const stopVerb = kind === 'financing' ? 'Clore' : incoming ? 'Arrêter' : 'Résilier'

  return (
    <>
      <RowMenu label={label}>
        {options && defaults && (
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <PencilIcon />
            Modifier
          </DropdownMenuItem>
        )}
        {kind === 'subscription' && (
          <DropdownMenuItem onSelect={() => setPricing(true)}>
            <BanknoteIcon />
            {incoming ? 'Changer le montant' : 'Changer le prix'}
          </DropdownMenuItem>
        )}
        {options && today && (
          <DropdownMenuItem onSelect={() => setMoving(true)}>
            <ArrowRightLeftIcon />
            Changer de compte
          </DropdownMenuItem>
        )}
        {kind === 'financing' && schedule && (
          <DropdownMenuItem onSelect={() => setRevising(true)}>
            <CalendarClockIcon />
            Réviser l’échéancier
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
              Le changement est daté et conservé : c’est ce qui permet de voir les hausses sur la durée.
              Actuellement {currency === 'EUR' ? eur(amount, 2) : money(amount, currency)}.
            </DialogDescription>
          </DialogHeader>
          <ActionForm action={changePriceAction} onSuccess={() => setPricing(false)}>
            <input type="hidden" name="commitmentId" value={commitmentId} />
            <Field label={incoming ? 'Nouveau montant' : 'Nouveau prix'} name="amount">
              <div className="flex gap-2">
                <AmountInput name="amount" defaultValue={amount.toFixed(2)} />
                <CurrencySelect defaultValue={currency} />
              </div>
            </Field>
            <SubmitButton className="self-start">Enregistrer</SubmitButton>
          </ActionForm>
        </DialogContent>
      </Dialog>

      {/* Dated on purpose: a move is usually known before it happens, and an
          occurrence confirmed after it left the account that was right then. */}
      <Dialog open={moving} onOpenChange={setMoving}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{label}</DialogTitle>
            <DialogDescription className="text-[12px]">
              {incoming ? 'Versé sur' : 'Prélevé sur'} {accountName} aujourd’hui. Chaque échéance suit le
              compte en vigueur à sa date.
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
              Corriger ce que cet engagement dit de lui-même. Le montant et le compte ont le leur, daté.
            </SheetDescription>
          </SheetHeader>
          <div className="p-4">
            {options && defaults && (
              <EditCommitmentForm
                commitmentId={commitmentId}
                kind={kind}
                incoming={incoming}
                defaults={{ label, ...defaults }}
                options={options}
                onDone={() => setEditing(false)}
              />
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
            <SheetDescription className="text-[12px]">
              L’échéancier fait foi : le restant dû et le total suivent ce qui est écrit ici. Modifier une
              échéance déjà payée corrige aussi son mouvement.
            </SheetDescription>
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
            <AlertDialogTitle>
              {stopVerb} « {label} » ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Il cesse de produire des échéances à partir d’aujourd’hui. Son historique et ses mouvements
              passés restent intacts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {cancelState.error && <p className="text-xs text-destructive">{cancelState.error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <form action={cancel}>
              <input type="hidden" name="commitmentId" value={commitmentId} />
              <Button type="submit" variant="destructive" disabled={cancelPending}>
                {cancelPending ? '…' : stopVerb}
              </Button>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
