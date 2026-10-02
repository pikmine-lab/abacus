'use client'

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CreditCardIcon,
  HistoryIcon,
  PencilIcon,
  ScaleIcon,
} from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { BalanceCheckHistory, type CheckEntry, type SettleOptions } from '@/components/balance-check-history'
import { NewCardForm } from '@/components/card-forms'
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  closeAccountAction,
  editAccountAction,
  recordBalanceCheckAction,
  reopenAccountAction,
} from '@/lib/actions'
import { eur } from '@/lib/utils'

const BEHAVIORS = [
  { value: 'payment', label: 'Courant' },
  { value: 'savings', label: 'Épargne (livret)' },
  { value: 'investment', label: 'Investissement' },
]

/**
 * Actions on an account, folded into one menu. Pointing a balance opens a
 * panel that states what the gesture means, comparing the bank's figure to
 * the computed one, because that comparison is the guardrail of a declarative
 * ledger, not a data-entry chore.
 */
export function AccountRowActions({
  accountId,
  name,
  institution,
  behavior,
  openingBalance,
  openedOn,
  computedBalance,
  closed,
  checks,
  settleOptions,
  newCard,
}: {
  accountId: string
  name: string
  institution: string
  behavior: string
  /** What the account already held when it was taken over, and the day it did. */
  openingBalance: string
  openedOn: string | null
  computedBalance: number
  closed?: boolean
  /** What was already pointed on this account, repairable from the panel. */
  checks: CheckEntry[]
  /** References a gap can be settled against, from that same panel. */
  settleOptions: SettleOptions
  /**
   * Current account only: what declaring a card on it needs. The card is added
   * from the account it debits, which is where it will be listed.
   */
  newCard?: { accounts: { id: string; name: string }[]; today: string }
}) {
  const [checking, setChecking] = useState(false)
  const [editing, setEditing] = useState(false)
  const [history, setHistory] = useState(false)
  const [closing, setClosing] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [addingCard, setAddingCard] = useState(false)
  const [closeState, close, closePending] = useActionState(closeAccountAction, {})
  const [reopenState, reopen, reopenPending] = useActionState(reopenAccountAction, {})

  useEffect(() => {
    if (closeState.ok) setClosing(false)
  }, [closeState.ok])
  useEffect(() => {
    if (reopenState.ok) setReopening(false)
  }, [reopenState.ok])

  return (
    <>
      <RowMenu label={name}>
        {!closed && (
          <DropdownMenuItem onSelect={() => setChecking(true)}>
            <ScaleIcon />
            Pointer le solde
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => setEditing(true)}>
          <PencilIcon />
          Modifier
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setHistory(true)}>
          <HistoryIcon />
          Pointages
        </DropdownMenuItem>
        {newCard && !closed && (
          <DropdownMenuItem onSelect={() => setAddingCard(true)}>
            <CreditCardIcon />
            Ajouter une carte
          </DropdownMenuItem>
        )}
        {closed ? (
          <DropdownMenuItem onSelect={() => setReopening(true)}>
            <ArchiveRestoreIcon />
            Réouvrir
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem variant="destructive" onSelect={() => setClosing(true)}>
            <ArchiveIcon />
            Clore le compte
          </DropdownMenuItem>
        )}
      </RowMenu>

      <CheckDialog
        accountId={accountId}
        name={name}
        computedBalance={computedBalance}
        open={checking}
        onOpenChange={setChecking}
      />

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{name}</DialogTitle>
            <DialogDescription className="text-[12px]">
              Son solde part de l’ouverture, puis suit ses mouvements.
            </DialogDescription>
          </DialogHeader>
          <ActionForm action={editAccountAction} onSuccess={() => setEditing(false)}>
            <input type="hidden" name="accountId" value={accountId} />
            <TextField name="name" label="Nom" defaultValue={name} />
            <TextField
              name="institution"
              label="Établissement (optionnel)"
              defaultValue={institution}
              placeholder="Nom de la banque"
            />
            <Field label="Type">
              <FormSelect name="behavior" defaultValue={behavior} options={BEHAVIORS} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Solde d’ouverture (€)" name="openingBalance">
                <AmountInput
                  name="openingBalance"
                  negatable
                  defaultValue={Number(openingBalance) === 0 ? '' : openingBalance}
                  placeholder="0,00"
                />
              </Field>
              <Field label="Ouvert le" name="openedOn">
                <DateField name="openedOn" defaultValue={openedOn ?? undefined} />
              </Field>
            </div>
            <SubmitButton className="self-start">Enregistrer</SubmitButton>
          </ActionForm>
        </DialogContent>
      </Dialog>

      <CheckHistorySheet
        name={name}
        checks={checks}
        settleOptions={settleOptions}
        open={history}
        onOpenChange={setHistory}
      />

      {newCard && (
        <Sheet open={addingCard} onOpenChange={setAddingCard}>
          <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
            <SheetHeader className="border-b border-border">
              <SheetTitle className="text-[15px]">Nouvelle carte</SheetTitle>
              <SheetDescription className="text-[12px]">
                Un nom suffit à la reconnaître, jamais son numéro.
              </SheetDescription>
            </SheetHeader>
            <div className="p-4">
              <NewCardForm accounts={newCard.accounts} accountId={accountId} today={newCard.today} />
            </div>
          </SheetContent>
        </Sheet>
      )}

      <AlertDialog open={closing} onOpenChange={setClosing}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clore « {name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Plus aucun mouvement après aujourd’hui. Son historique reste entier, et tu peux le réouvrir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {closeState.error && <p className="text-xs text-destructive">{closeState.error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <form action={close}>
              <input type="hidden" name="accountId" value={accountId} />
              <Button type="submit" variant="destructive" disabled={closePending}>
                {closePending ? '…' : 'Clore'}
              </Button>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={reopening} onOpenChange={setReopening}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Réouvrir « {name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le compte accepte de nouveau des mouvements. Son historique ne change pas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {reopenState.error && <p className="text-xs text-destructive">{reopenState.error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <form action={reopen}>
              <input type="hidden" name="accountId" value={accountId} />
              <Button type="submit" disabled={reopenPending}>
                {reopenPending ? '…' : 'Réouvrir'}
              </Button>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * Pointing a balance: the bank's figure, set against the computed one. The
 * computed side is shown because the gap between them is the whole point of
 * the gesture, and the panel lets it be seen before it is recorded.
 */
function CheckDialog({
  accountId,
  name,
  computedBalance,
  open,
  onOpenChange,
}: {
  accountId: string
  name: string
  computedBalance: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Pointer {name}</DialogTitle>
          <DialogDescription className="text-[12px]">
            Le solde que ta banque affiche, face au calculé : {eur(computedBalance, 2)}.
          </DialogDescription>
        </DialogHeader>
        <ActionForm action={recordBalanceCheckAction} onSuccess={() => onOpenChange(false)}>
          <input type="hidden" name="accountId" value={accountId} />
          <Field label="Solde réel (€)" name="balance">
            <AmountInput name="balance" placeholder="0,00" />
          </Field>
          <SubmitButton className="self-start">Pointer</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  )
}

/** A history has as many rows as the account was pointed: it needs the panel's height. */
function CheckHistorySheet({
  name,
  checks,
  settleOptions,
  open,
  onOpenChange,
}: {
  name: string
  checks: CheckEntry[]
  settleOptions: SettleOptions
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="text-[15px]">Pointages de {name}</SheetTitle>
          <SheetDescription className="text-[12px]">
            Le solde lu, face au calculé ce jour-là.
          </SheetDescription>
        </SheetHeader>
        <div className="p-4">
          <BalanceCheckHistory checks={checks} options={settleOptions} />
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * One line of the "À pointer" card: an account whose balance is not known to
 * hold, and the gesture that settles it. An open gap leads to the history,
 * where it is explained or settled; a check missing or too old leads to a new
 * one. The same panels as the row's menu, so the card adds a way in, not a
 * gesture.
 */
export function PendingCheck({
  accountId,
  name,
  computedBalance,
  checks,
  settleOptions,
  detail,
  gap,
}: {
  accountId: string
  name: string
  computedBalance: number
  checks: CheckEntry[]
  settleOptions: SettleOptions
  /** What is wrong with it, in a few words: the gap, or the age of the last check. */
  detail: string
  gap: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
        <span className="truncate text-[13.5px] font-medium">{name}</span>
        <span className={gap ? 'text-[12px] text-destructive' : 'text-[12px] text-faint'}>{detail}</span>
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0"
        aria-label={gap ? `Voir l’écart de ${name}` : `Pointer ${name}`}
        onClick={() => setOpen(true)}
      >
        {gap ? 'Voir l’écart' : 'Pointer'}
      </Button>
      {gap ? (
        <CheckHistorySheet
          name={name}
          checks={checks}
          settleOptions={settleOptions}
          open={open}
          onOpenChange={setOpen}
        />
      ) : (
        <CheckDialog
          accountId={accountId}
          name={name}
          computedBalance={computedBalance}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </div>
  )
}
