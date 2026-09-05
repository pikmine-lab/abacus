'use client'

import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { ActionForm, DateField, Field, FormSelect, SubmitButton } from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { declareMovementAction } from '@/lib/actions'
import { eur } from '@/lib/utils'

interface Option {
  id: string
  name: string
}

/**
 * Paying oneself: a transfer out of the activity's accounts, prefilled with
 * what the statement says is payable and editable, because that figure is an
 * estimate and the decision stays the owner's. It is a movement like any
 * other afterwards, which is what keeps the balances and the balance checks
 * telling the same story.
 *
 * Only accounts outside the activity are offered as a target: a transfer
 * between two of its own accounts moves nothing out of it.
 */
export function ActivityPayout({
  amount,
  from,
  to,
  today,
}: {
  /** What is payable today; zero or less leaves the field empty. */
  amount: number
  /** The activity's own accounts, one of which the money leaves. */
  from: Option[]
  /** Accounts outside the activity, where it lands. */
  to: Option[]
  today: string
}) {
  const [open, setOpen] = useState(false)
  const payable = amount > 0

  if (from.length === 0 || to.length === 0)
    return (
      <p className="text-[11.5px] text-faint">
        {from.length === 0
          ? 'Aucun compte n’est rattaché à cette activité : rattache-en un dans Réglages pour te verser.'
          : 'Tous tes comptes sont rattachés à cette activité : il n’y a pas de compte perso où te verser.'}
      </p>
    )

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" onClick={() => setOpen(true)}>
        {payable ? `Me verser ${eur(amount)}` : 'Me verser…'}
      </Button>
      <p className="text-[11.5px] text-faint">
        {payable
          ? 'ouvre le virement vers un compte hors activité, montant modifiable'
          : 'rien de disponible : la réserve et les échéances couvrent la trésorerie'}
      </p>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader className="border-b border-border">
            <SheetTitle className="text-[15px]">Me verser</SheetTitle>
            <SheetDescription className="text-[12px]">
              Un virement de l’activité vers un compte perso. Il ne change ni le net ni ce qui est dû : il
              sort l’argent de l’activité.
            </SheetDescription>
          </SheetHeader>
          <div className="p-4">
            <ActionForm action={declareMovementAction} successLabel="Virement déclaré">
              <input type="hidden" name="type" value="transfer" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date" name="date">
                  <DateField name="date" defaultValue={today} />
                </Field>
                <Field label="Montant" name="amount">
                  <AmountInput
                    name="amount"
                    placeholder="1 200,00"
                    defaultValue={payable ? amount.toFixed(2) : ''}
                  />
                </Field>
              </div>
              <Field label="Depuis le compte" name="accountId">
                <FormSelect
                  name="accountId"
                  placeholder="Compte de l’activité"
                  options={from.map((a) => ({ value: a.id, label: a.name }))}
                  defaultValue={from[0]?.id ?? ''}
                />
              </Field>
              <Field label="Vers le compte" name="toAccountId">
                <FormSelect
                  name="toAccountId"
                  placeholder="Compte perso"
                  options={to.map((a) => ({ value: a.id, label: a.name }))}
                  defaultValue={to[0]?.id ?? ''}
                />
              </Field>
              <SubmitButton className="self-start">Déclarer le virement</SubmitButton>
            </ActionForm>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
