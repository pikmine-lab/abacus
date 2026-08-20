'use client'

import { BanIcon, PencilIcon } from 'lucide-react'
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
import { cancelCommitmentAction, changePriceAction } from '@/lib/actions'
import { eur } from '@/lib/utils'

/**
 * Life-cycle actions of a recurring commitment. Changing the amount is
 * historised on purpose — that log is what lets the app say "+40 % in two
 * years" — so it happens in a panel that says so, not in a field sitting in
 * the row.
 */
export function CommitmentRowActions({
  commitmentId,
  label,
  amount,
  kind,
  incoming,
}: {
  commitmentId: string
  label: string
  amount: number
  kind: 'subscription' | 'financing'
  incoming: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [cancelState, cancel, cancelPending] = useActionState(cancelCommitmentAction, {})

  useEffect(() => {
    if (cancelState.ok) setConfirming(false)
  }, [cancelState.ok])

  const stopVerb = kind === 'financing' ? 'Clore' : incoming ? 'Arrêter' : 'Résilier'

  return (
    <>
      <RowMenu label={label}>
        {kind === 'subscription' && (
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <PencilIcon />
            {incoming ? 'Changer le montant' : 'Changer le prix'}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
          <BanIcon />
          {stopVerb}
        </DropdownMenuItem>
      </RowMenu>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{label}</DialogTitle>
            <DialogDescription className="text-[12px]">
              Le changement est daté et conservé : c’est ce qui permet de voir les hausses sur la durée.
              Actuellement {eur(amount, 2)}.
            </DialogDescription>
          </DialogHeader>
          <ActionForm action={changePriceAction} onSuccess={() => setEditing(false)}>
            <input type="hidden" name="commitmentId" value={commitmentId} />
            <Field label={incoming ? 'Nouveau montant (€)' : 'Nouveau prix (€)'} name="amount">
              <AmountInput name="amount" defaultValue={amount.toFixed(2)} />
            </Field>
            <SubmitButton className="self-start">Enregistrer</SubmitButton>
          </ActionForm>
        </DialogContent>
      </Dialog>

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
