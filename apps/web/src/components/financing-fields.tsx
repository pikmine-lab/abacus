'use client'

import { PencilIcon, RotateCcwIcon } from 'lucide-react'
import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { DateField, Field } from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { eur, frDate } from '@/lib/utils'

/**
 * A payment plan, stated the way the contract states it: a total over N
 * installments. The schedule that follows is shown, not asked: equal amounts
 * one period apart, the rounding cent on the last line.
 *
 * It becomes editable line by line on request, because real plans are rarely
 * regular: a bigger deposit, a prorated first month, a date pushed off a
 * weekend, a rounding that the seller put on the second line rather than the
 * last. Which line differs is not something the app can guess, so all of them
 * are editable (amount and date) once the user asks.
 */

interface Line {
  dueOn: string
  amount: string
}

/** Same rule as the server's defaultSchedule: the remainder lands on the last. */
function buildSchedule(total: number, count: number, firstDueOn: string): Line[] {
  const cents = Math.round(total * 100)
  const share = Math.floor(cents / count)
  const [y, m, d] = firstDueOn.split('-').map(Number)
  return Array.from({ length: count }, (_, index) => {
    const amount = index === count - 1 ? cents - share * (count - 1) : share
    // Same clamping as the domain's addPeriod: the 31st falls on the 28th in
    // February rather than sliding into March.
    const month = m! - 1 + index
    const year = y! + Math.floor(month / 12)
    const monthIndex = ((month % 12) + 12) % 12
    const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
    const day = String(Math.min(d!, lastDay)).padStart(2, '0')
    return {
      dueOn: `${year}-${String(monthIndex + 1).padStart(2, '0')}-${day}`,
      amount: (amount / 100).toFixed(2),
    }
  })
}

export function FinancingAmountFields({ today }: { today: string }) {
  const [total, setTotal] = useState('')
  const [count, setCount] = useState('')
  const [firstDueOn, setFirstDueOn] = useState(today)
  const [lines, setLines] = useState<Line[] | null>(null)

  const totalValue = Number(total)
  const countValue = Number(count)
  const canBuild =
    Number.isFinite(totalValue) && totalValue > 0 && Number.isInteger(countValue) && countValue >= 2
  const preview = canBuild ? buildSchedule(totalValue, countValue, firstDueOn) : null

  const scheduled = lines
    ? lines.reduce((sum, line) => sum + Math.round((Number(line.amount) || 0) * 100), 0)
    : 0
  const gap = lines ? scheduled - Math.round(totalValue * 100) : 0

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Montant total (€)" name="totalAmount">
          <AmountInput
            name="totalAmount"
            placeholder="1 000"
            onValueChange={(value) => {
              setTotal(value)
              setLines(null)
            }}
          />
        </Field>
        <Field label="Nombre d’échéances" name="installmentsTotal">
          <Input
            name="installmentsTotal"
            inputMode="numeric"
            placeholder="4"
            value={count}
            onChange={(e) => {
              setCount(e.target.value.replace(/\D/g, ''))
              setLines(null)
            }}
          />
        </Field>
      </div>

      {/* The first date drives the generated schedule; each line can move after. */}
      <Field label="Première échéance" name="firstDueOn">
        <DateField
          name="firstDueOn"
          defaultValue={today}
          onValueChange={(day) => {
            setFirstDueOn(day)
            setLines(null)
          }}
        />
      </Field>

      {lines === null ? (
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-faint">
          {preview ? (
            <span>
              {preview.length} échéances de{' '}
              <span className="font-mono text-muted-foreground tabular">
                {eur(Number(preview[0]!.amount), 2)}
              </span>
              {preview[preview.length - 1]!.amount !== preview[0]!.amount && (
                <>
                  , la dernière de{' '}
                  <span className="font-mono text-muted-foreground tabular">
                    {eur(Number(preview[preview.length - 1]!.amount), 2)}
                  </span>
                </>
              )}
              , du {frDate(preview[0]!.dueOn)} au {frDate(preview[preview.length - 1]!.dueOn)}.
            </span>
          ) : (
            <span>Renseigne le total et le nombre d’échéances : le plan se calcule tout seul.</span>
          )}
          {preview && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-[12px]"
              onClick={() => setLines(preview)}
            >
              <PencilIcon className="size-3.5" />
              Ajuster chaque échéance
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-[11.5px] text-muted-foreground">
              Échéancier : ajuste les dates et les montants qui diffèrent.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-[12px] text-muted-foreground"
              onClick={() => setLines(null)}
            >
              <RotateCcwIcon className="size-3.5" />
              Revenir au calcul
            </Button>
          </div>

          <div className="flex flex-col divide-y divide-border/70 border-y border-border">
            {lines.map((line, index) => (
              // Position is the identity here: two installments may legitimately
              // share a date, and the contractual order is what matters.
              // biome-ignore lint/suspicious/noArrayIndexKey: the row *is* its position in the plan
              <div key={index} className="flex items-center gap-2 py-1.5">
                <span className="w-6 shrink-0 font-mono text-[11px] text-faint tabular">{index + 1}</span>
                <div className="w-44">
                  <DateField
                    name="installmentDueOn"
                    defaultValue={line.dueOn}
                    onValueChange={(day) =>
                      setLines(lines.map((l, i) => (i === index ? { ...l, dueOn: day } : l)))
                    }
                  />
                </div>
                <AmountInput
                  name="installmentAmount"
                  defaultValue={line.amount}
                  aria-label={`Montant de l’échéance ${index + 1}`}
                  className="ml-auto h-7 w-28 text-[12.5px]"
                  onValueChange={(value) =>
                    setLines(lines.map((l, i) => (i === index ? { ...l, amount: value } : l)))
                  }
                />
              </div>
            ))}
          </div>

          <p className={`text-[11.5px] ${gap === 0 ? 'text-faint' : 'text-destructive'}`}>
            Total de l’échéancier <span className="font-mono tabular">{eur(scheduled / 100, 2)}</span>
            {gap === 0
              ? ' : il correspond au total dû.'
              : ` : ${gap > 0 ? 'dépasse' : 'manque'} de ${eur(Math.abs(gap) / 100, 2)} par rapport au total dû.`}
          </p>
        </div>
      )}
    </>
  )
}
