'use client'

import { ArchiveIcon, ScaleIcon } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import { AmountInput } from '@/components/amount-input'
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
import { closeAccountAction, recordBalanceCheckAction } from '@/lib/actions'
import { eur } from '@/lib/utils'

/**
 * Actions on an account, folded into one menu. Pointing a balance opens a
 * panel that states what the gesture means, comparing the bank's figure to
 * the computed one, because that comparison is the guardrail of a declarative
 * ledger, not a data-entry chore.
 */
export function AccountRowActions({
  accountId,
  name,
  computedBalance,
}: {
  accountId: string
  name: string
  computedBalance: number
}) {
  const [checking, setChecking] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closeState, close, closePending] = useActionState(closeAccountAction, {})

  useEffect(() => {
    if (closeState.ok) setClosing(false)
  }, [closeState.ok])

  return (
    <>
      <RowMenu label={name}>
        <DropdownMenuItem onSelect={() => setChecking(true)}>
          <ScaleIcon />
          Pointer le solde
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => setClosing(true)}>
          <ArchiveIcon />
          Clore le compte
        </DropdownMenuItem>
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

      <AlertDialog open={closing} onOpenChange={setClosing}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clore « {name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le compte n’accepte plus de nouveaux mouvements après aujourd’hui. Son historique reste entier :
              l’app garde la trace de ce qui s’y est passé.
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
    </>
  )
}
