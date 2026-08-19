'use client'

import { ActionForm, SubmitButton } from '@/components/forms'
import { Input } from '@/components/ui/input'
import { recordBalanceCheckAction } from '@/lib/actions'

export function BalanceCheckForm({ accountId }: { accountId: string }) {
  return (
    <ActionForm action={recordBalanceCheckAction} className="flex-row items-center gap-2">
      <input type="hidden" name="accountId" value={accountId} />
      <Input
        name="balance"
        required
        inputMode="decimal"
        placeholder="Solde réel"
        className="h-8 w-28 text-[13px]"
        aria-label="Solde réel lu dans la banque"
      />
      <SubmitButton variant="outline" size="sm">
        Pointer
      </SubmitButton>
    </ActionForm>
  )
}
