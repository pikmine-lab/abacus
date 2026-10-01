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
import { revokeAuthorizationAction } from '@/lib/actions'

/**
 * Revoking is one click away from cutting an agent off: it belongs behind a
 * confirmation, in the row menu like every other row-level action. Unlike a
 * deleted key it can be granted again, by connecting the client once more.
 */
export function AuthorizationRowActions({ consentId, name }: { consentId: string; name: string }) {
  const [revoking, setRevoking] = useState(false)

  return (
    <>
      <RowMenu label={`l’accès de ${name}`}>
        <DropdownMenuItem variant="destructive" onSelect={() => setRevoking(true)}>
          <Trash2Icon />
          Révoquer l’accès
        </DropdownMenuItem>
      </RowMenu>

      <AlertDialog open={revoking} onOpenChange={setRevoking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Révoquer l’accès de « {name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Il perd l’accès d’ici dix minutes au plus. Pour le rebrancher, il faudra l’autoriser à nouveau.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <form action={revokeAuthorizationAction}>
              <input type="hidden" name="consentId" value={consentId} />
              <SubmitButton variant="destructive">Révoquer</SubmitButton>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
