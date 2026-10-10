'use client'

import { Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
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
  const t = useTranslations('settings.connectAi.revoke')
  const [revoking, setRevoking] = useState(false)

  return (
    <>
      <RowMenu label={t('menuLabel', { name })}>
        <DropdownMenuItem variant="destructive" onSelect={() => setRevoking(true)}>
          <Trash2Icon />
          {t('action')}
        </DropdownMenuItem>
      </RowMenu>

      <AlertDialog open={revoking} onOpenChange={setRevoking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('title', { name })}</AlertDialogTitle>
            <AlertDialogDescription>{t('description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <form action={revokeAuthorizationAction}>
              <input type="hidden" name="consentId" value={consentId} />
              <SubmitButton variant="destructive">{t('submit')}</SubmitButton>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
