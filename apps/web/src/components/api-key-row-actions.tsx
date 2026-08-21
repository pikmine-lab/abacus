'use client'

import { Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { SubmitButton } from '@/components/forms'
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
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { deleteApiKeyAction } from '@/lib/actions'

/**
 * Revoking is one click away from cutting an agent off, and nothing undoes it:
 * it belongs behind a confirmation, in the row menu like every other row-level
 * action.
 */
export function ApiKeyRowActions({ keyId, name }: { keyId: string; name: string }) {
  const [revoking, setRevoking] = useState(false)

  return (
    <>
      <RowMenu label={`la clé ${name}`}>
        <DropdownMenuItem variant="destructive" onSelect={() => setRevoking(true)}>
          <Trash2Icon />
          Révoquer la clé
        </DropdownMenuItem>
      </RowMenu>

      <AlertDialog open={revoking} onOpenChange={setRevoking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Révoquer « {name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              L’agent qui l’utilise perd l’accès aussitôt, et une clé révoquée ne revient pas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <form action={deleteApiKeyAction}>
              <input type="hidden" name="keyId" value={keyId} />
              <SubmitButton variant="destructive">Révoquer</SubmitButton>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
