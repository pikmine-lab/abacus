'use client'

import { CalendarIcon, CoinsIcon, SkipForwardIcon } from 'lucide-react'
import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { DateField } from '@/components/forms'
import { Rows } from '@/components/page-shell'
import { RowMenu } from '@/components/row-menu'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { confirmOccurrenceAction, skipOccurrenceAction } from '@/lib/actions'
import { eur, frDate, money } from '@/lib/utils'

export interface PendingItem {
  commitmentId: string
  label: string
  dueOn: string
  /** In the commitment's currency, like the field that confirms it. */
  amount: number
  currency: string
  incoming: boolean
  /**
   * The account of its own date, which is not always the one the commitment
   * hits today: an occurrence left pending across a move keeps the old one.
   */
  account: string
  /**
   * Investment plan only: where the money goes and what it buys. Its presence
   * is what turns the confirmation into a two-write gesture, and what makes the
   * quantity required.
   */
  placement?: { targetAccount: string; asset: string }
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
 *
 * A scheduled placement asks for one thing more, and it is not optional: the
 * quantity bought. The order executed at a price no daily close reproduces, so
 * nothing here can work it out. What the broker did not invest is the rarer
 * case, so it lives behind the row's menu rather than in the way.
 */
export function PendingOccurrences({
  items,
  back,
}: {
  items: PendingItem[]
  /** Where a failed action comes back to, with its message. */
  back: string
}) {
  return (
    <Rows>
      {items.map((item) => (
        <PendingRow key={`${item.commitmentId}-${item.dueOn}`} item={item} back={back} />
      ))}
    </Rows>
  )
}

function PendingRow({ item, back }: { item: PendingItem; back: string }) {
  const expected = item.amount.toFixed(2)
  const [amount, setAmount] = useState(expected)
  const [dateOpen, setDateOpen] = useState(false)
  const [partial, setPartial] = useState(false)
  const [quantity, setQuantity] = useState('')
  const placement = item.placement
  const foreign = item.currency !== 'EUR'
  const inCurrency = (value: number) => (foreign ? money(value, item.currency) : eur(value, 2))

  const entered = Number(amount)
  const differs = amount !== '' && Number.isFinite(entered) && entered !== item.amount
  const gap = entered - item.amount

  return (
    <div className="flex flex-col gap-2 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-medium">{item.label}</p>
          <p className="text-[11px] text-faint">
            attendu le {frDate(item.dueOn)} ·{' '}
            {placement
              ? `versement de ${inCurrency(item.amount)} de ${item.account} vers ${placement.targetAccount} · achète ${placement.asset}`
              : `${item.incoming ? 'entrée' : 'prélèvement'} de ${inCurrency(item.amount)} sur ${item.account}`}
          </p>
        </div>

        <form action={confirmOccurrenceAction} className="ml-auto flex flex-wrap items-center gap-2">
          <input type="hidden" name="commitmentId" value={item.commitmentId} />
          <input type="hidden" name="back" value={back} />
          <AmountInput
            name="amount"
            defaultValue={expected}
            onValueChange={setAmount}
            className="h-7 w-28 text-[12.5px]"
            aria-label={`Montant réellement ${placement ? 'versé' : item.incoming ? 'reçu' : 'prélevé'}${foreign ? ` (${item.currency})` : ''}`}
          />
          {foreign && (
            <AmountInput
              name="eurAmount"
              placeholder="€ au cours du jour"
              className="h-7 w-36 text-[12.5px]"
              aria-label={`Euros réellement ${item.incoming ? 'crédités' : 'débités'} (optionnel)`}
            />
          )}
          {/* Required, and typed as the broker states it: fractions are the
              norm on a fixed-sum order. */}
          {placement && (
            <Input
              name="quantity"
              inputMode="decimal"
              placeholder="parts achetées"
              autoComplete="off"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="h-7 w-32 text-[12.5px]"
              aria-label="Quantité achetée, telle que le courtier l’affiche"
            />
          )}
          {placement && partial && (
            <AmountInput
              name="investedAmount"
              placeholder="€ investis"
              className="h-7 w-32 text-[12.5px]"
              aria-label="Montant réellement investi, si le courtier n’a pas tout investi"
            />
          )}
          {dateOpen && (
            <div className="w-40">
              <DateField name="date" defaultValue={item.dueOn} />
            </div>
          )}
          <Button size="sm" type="submit" className="h-7" disabled={placement !== undefined && !quantity}>
            Confirmer
          </Button>

          {/* The one thing the app cannot guess, asked only when it applies. */}
          {differs && (
            <Label className="flex w-full items-center gap-2 text-[11.5px] font-normal text-muted-foreground">
              <Checkbox name="newAmount" />
              <span>
                écart de{' '}
                <span className={gap > 0 === item.incoming ? 'text-good' : 'text-destructive'}>
                  {`${gap > 0 ? '+' : '−'}${inCurrency(Math.abs(gap))}`}
                </span>{' '}
                : c’est le nouveau montant habituel
              </span>
            </Label>
          )}
        </form>

        <RowMenu label={item.label}>
          <DropdownMenuItem onSelect={() => setDateOpen((v) => !v)}>
            <CalendarIcon />
            {dateOpen
              ? 'Garder la date attendue'
              : placement
                ? 'Versé à une autre date…'
                : 'Reçu à une autre date…'}
          </DropdownMenuItem>
          {/* A broker that buys no fraction leaves the remainder in cash, which
              is where it really is: the rarer case, so it is asked for. */}
          {placement && (
            <DropdownMenuItem onSelect={() => setPartial((v) => !v)}>
              <CoinsIcon />
              {partial ? 'Tout a été investi' : 'Une partie est restée en espèces…'}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild variant="destructive">
            <form action={skipOccurrenceAction}>
              <input type="hidden" name="commitmentId" value={item.commitmentId} />
              <input type="hidden" name="back" value={back} />
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
