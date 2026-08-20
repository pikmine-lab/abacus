'use client'

import { AmountInput } from '@/components/amount-input'
import { ActionForm, SubmitButton } from '@/components/forms'
import { recordBalanceCheckAction } from '@/lib/actions'

export function BalanceCheckForm({ accountId }: { accountId: string }) {
  return (
    <ActionForm action={recordBalanceCheckAction} className="flex-row items-center gap-2">
      <input type="hidden" name="accountId" value={accountId} />
      <AmountInput
        name="balance"
        required
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
