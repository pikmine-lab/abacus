'use client'

import { ArchiveIcon, ArchiveRestoreIcon, HistoryIcon, PencilIcon, ScaleIcon } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { BalanceCheckHistory, type CheckEntry, type SettleOptions } from '@/components/balance-check-history'
import { ActionForm, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
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
  computedBalance,
  closed,
  checks,
  settleOptions,
}: {
  accountId: string
  name: string
  institution: string
  behavior: string
  computedBalance: number
  closed?: boolean
  /** What was already pointed on this account, repairable from the panel. */
  checks: CheckEntry[]
  /** References a gap can be settled against, from that same panel. */
  settleOptions: SettleOptions
}) {
  const [checking, setChecking] = useState(false)
  const [editing, setEditing] = useState(false)
  const [history, setHistory] = useState(false)
  const [closing, setClosing] = useState(false)
  const [reopening, setReopening] = useState(false)
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

      <Dialog open={checking} onOpenChange={setChecking}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Pointer {name}</DialogTitle>
            <DialogDescription className="text-[12px]">
              Saisis le solde lu dans ta banque. L’app le compare au solde calculé depuis tes déclarations (
              {eur(computedBalance, 2)}) et te signale l’écart, que tu pourras solder par un ajustement.
            </DialogDescription>
          </DialogHeader>
          <ActionForm action={recordBalanceCheckAction} onSuccess={() => setChecking(false)}>
            <input type="hidden" name="accountId" value={accountId} />
            <Field label="Solde réel (€)" name="balance">
              <AmountInput name="balance" placeholder="0,00" />
            </Field>
            <SubmitButton className="self-start">Pointer</SubmitButton>
          </ActionForm>
        </DialogContent>
      </Dialog>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{name}</DialogTitle>
            <DialogDescription className="text-[12px]">
              Ce que ce compte dit de lui-même. Son solde vient des mouvements, il ne se saisit pas.
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
            <SubmitButton className="self-start">Enregistrer</SubmitButton>
          </ActionForm>
        </DialogContent>
      </Dialog>

      {/* A history has as many rows as the account was pointed: it needs the
          panel's height, and the row stays visible behind it. */}
      <Sheet open={history} onOpenChange={setHistory}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader className="border-b border-border">
            <SheetTitle className="text-[15px]">Pointages de {name}</SheetTitle>
            <SheetDescription className="text-[12px]">
              Chaque ligne confronte le solde lu dans ta banque au solde calculé, ce jour-là.
            </SheetDescription>
          </SheetHeader>
          <div className="p-4">
            <BalanceCheckHistory checks={checks} options={settleOptions} />
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={closing} onOpenChange={setClosing}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clore « {name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le compte n’accepte plus de nouveaux mouvements après aujourd’hui. Son historique reste entier :
              l’app garde la trace de ce qui s’y est passé, et tu peux le réouvrir.
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
