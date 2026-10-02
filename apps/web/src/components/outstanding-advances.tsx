'use client'

import { CalendarIcon, HandCoinsIcon } from 'lucide-react'
import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { DateField } from '@/components/forms'
import { RowMenu } from '@/components/row-menu'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { closeAdvanceAction, refundAdvanceAction } from '@/lib/actions'
import { eur, frDate } from '@/lib/utils'

export interface OpenAdvance {
  movementId: string
  /** Who the money went to, the expense as it reads in the list. */
  label: string
  happenedOn: string
  debtor: string
  /** The account that paid, which is where the refund is written. */
  account: string
  expense: number
  expected: number
  refunded: number
  remaining: number
}

/**
 * Advances still out there, as the lines of the screen's action card. A claim
 * is work to do, so it lives at the top of the ledger rather than in a filter:
 * who owes and how much leads the line, and the gesture that closes it is
 * right there.
 *
 * "Remboursé" writes the income, it does not tick a box: the money really
 * landed on the account that paid, and a balance check would catch a claim
 * closed without it. The line names that account, so the income is not
 * declared a second time by hand. The amount stays editable, because a refund
 * arrives partial as often as whole.
 */
export function OutstandingAdvances({
  advances,
  today,
  back,
}: {
  advances: OpenAdvance[]
  today: string
  /** Where a failed action comes back to, with its message. */
  back: string
}) {
  return (
    <>
      {advances.map((advance) => (
        // Keyed on what is left: after a partial refund the row remounts, so
        // the amount field states the new remainder instead of the figure that
        // was just submitted.
        <AdvanceRow
          key={`${advance.movementId}-${advance.remaining}`}
          advance={advance}
          today={today}
          back={back}
        />
      ))}
    </>
  )
}

function AdvanceRow({ advance, today, back }: { advance: OpenAdvance; today: string; back: string }) {
  const [dateOpen, setDateOpen] = useState(false)
  const partial = advance.expected < advance.expense

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="truncate text-[13.5px] font-medium">
          {advance.debtor} doit <span className="tabular">{eur(advance.remaining, 2)}</span>
        </p>
        <p className="text-[12px] text-faint">
          {advance.label} · {eur(advance.expense, 2)} le {frDate(advance.happenedOn)}
          {/* The share expected only says something new once part of it came
              back: before that it is the figure the line leads with. */}
          {partial && advance.refunded > 0 && `, ${eur(advance.expected, 2)} attendus`}
          {advance.refunded > 0 && `, ${eur(advance.refunded, 2)} déjà revenus`} · revient sur{' '}
          {advance.account}
        </p>
      </div>

      <form action={refundAdvanceAction} className="ml-auto flex flex-wrap items-center gap-2">
        <input type="hidden" name="movementId" value={advance.movementId} />
        <input type="hidden" name="back" value={back} />
        <AmountInput
          name="amount"
          defaultValue={advance.remaining.toFixed(2)}
          className="h-7 w-28 text-[12.5px]"
          aria-label={`Montant remboursé par ${advance.debtor}`}
        />
        {dateOpen && (
          <div className="w-40">
            <DateField name="date" defaultValue={today} />
          </div>
        )}
        <Button size="sm" type="submit" className="h-7">
          Remboursé
        </Button>
      </form>

      <RowMenu label={advance.label}>
        <DropdownMenuItem onSelect={() => setDateOpen((v) => !v)}>
          <CalendarIcon />
          {dateOpen ? 'Revenu aujourd’hui' : 'Revenu à une autre date…'}
        </DropdownMenuItem>
        <DropdownMenuItem asChild variant="destructive">
          <form action={closeAdvanceAction}>
            <input type="hidden" name="movementId" value={advance.movementId} />
            <input type="hidden" name="back" value={back} />
            <button type="submit" className="flex w-full items-center gap-2">
              <HandCoinsIcon />
              Solder : il ne rendra rien
            </button>
          </form>
        </DropdownMenuItem>
      </RowMenu>
    </div>
  )
}
