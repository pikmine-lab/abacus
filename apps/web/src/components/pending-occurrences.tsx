'use client'

import { CalendarIcon, SkipForwardIcon } from 'lucide-react'
import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { DateField } from '@/components/forms'
import { Rows } from '@/components/page-shell'
import { RowMenu } from '@/components/row-menu'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { confirmOccurrenceAction, skipOccurrenceAction } from '@/lib/actions'
import { eur, eurSigned, frDate } from '@/lib/utils'

export interface PendingItem {
  commitmentId: string
  label: string
  dueOn: string
  amount: number
  incoming: boolean
}

/**
 * Expected occurrences awaiting a decision. Confirming is not a yes/no: the
 * amount is editable in place because reality diverges routinely: a salary
 * moves with the number of working days, a bonus lands, a subscription creeps
 * up. Recording the truth always wins over the expectation.
 *
 * Once the entered amount differs, one question appears, is this the new
 * normal? Because that is the only thing the app cannot infer, and the
 * answer decides between a one-off month and a historised price change.
 */
export function PendingOccurrences({
  items,
  retour,
}: {
  items: PendingItem[]
  /** Where a failed action comes back to, with its message. */
  retour: string
}) {
  return (
    <Rows>
      {items.map((item) => (
        <PendingRow key={`${item.commitmentId}-${item.dueOn}`} item={item} retour={retour} />
      ))}
    </Rows>
  )
}

function PendingRow({ item, retour }: { item: PendingItem; retour: string }) {
  const expected = item.amount.toFixed(2)
  const [amount, setAmount] = useState(expected)
  const [dateOpen, setDateOpen] = useState(false)

  const entered = Number(amount)
  const differs = amount !== '' && Number.isFinite(entered) && entered !== item.amount
  const gap = entered - item.amount

  return (
    <div className="flex flex-col gap-2 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-medium">{item.label}</p>
          <p className="text-[11px] text-faint">
            attendu le {frDate(item.dueOn)} · {item.incoming ? 'entrée' : 'prélèvement'} de{' '}
            {eur(item.amount, 2)}
          </p>
        </div>

        <form action={confirmOccurrenceAction} className="ml-auto flex flex-wrap items-center gap-2">
          <input type="hidden" name="commitmentId" value={item.commitmentId} />
          <input type="hidden" name="retour" value={retour} />
          <AmountInput
            name="amount"
            defaultValue={expected}
            onValueChange={setAmount}
            className="h-7 w-28 text-[12.5px]"
            aria-label={`Montant réellement ${item.incoming ? 'reçu' : 'prélevé'}`}
          />
          {dateOpen && (
            <div className="w-40">
              <DateField name="date" defaultValue={item.dueOn} />
            </div>
          )}
          <Button size="sm" type="submit" className="h-7">
            Confirmer
          </Button>

          {/* The one thing the app cannot guess, asked only when it applies. */}
          {differs && (
            <Label className="flex w-full items-center gap-2 text-[11.5px] font-normal text-muted-foreground">
              <Checkbox name="nouveauMontant" />
              <span>
                écart de{' '}
                <span className={gap > 0 === item.incoming ? 'text-good' : 'text-destructive'}>
                  {eurSigned(gap, 2)}
                </span>{' '}
                : c’est le nouveau montant habituel
              </span>
            </Label>
          )}
        </form>

        <RowMenu label={item.label}>
          <DropdownMenuItem onSelect={() => setDateOpen((v) => !v)}>
            <CalendarIcon />
            {dateOpen ? 'Garder la date attendue' : 'Reçu à une autre date…'}
          </DropdownMenuItem>
          <DropdownMenuItem asChild variant="destructive">
            <form action={skipOccurrenceAction}>
              <input type="hidden" name="commitmentId" value={item.commitmentId} />
              <input type="hidden" name="retour" value={retour} />
              <button type="submit" className="flex w-full items-center gap-2">
                <SkipForwardIcon />
                Passer cette échéance
              </button>
            </form>
          </DropdownMenuItem>
        </RowMenu>
      </div>
    </div>
  )
}
