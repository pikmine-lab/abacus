'use client'

import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { Field } from '@/components/forms'
import { Input } from '@/components/ui/input'
import { eur } from '@/lib/utils'

/**
 * A payment plan is stated the way the contract states it: a total over N
 * installments. The per-installment amount is the division, shown as it is
 * computed rather than asked for — that is the number people mistype.
 *
 * It only becomes editable on request, because the division rarely lands on a
 * round cent (1 000 € in 3 is 333,33 then 333,34) and only the contract says
 * how the remainder is spread. Left alone, the derived value is used and the
 * remaining due stays exact anyway: it is derived from the total, never from a
 * sum of rounded installments.
 */
export function FinancingAmountFields() {
  const [total, setTotal] = useState('')
  const [count, setCount] = useState('')
  const [manual, setManual] = useState(false)

  const totalValue = Number(total)
  const countValue = Number(count)
  const derived =
    Number.isFinite(totalValue) && totalValue > 0 && Number.isInteger(countValue) && countValue > 1
      ? Math.round((totalValue / countValue) * 100) / 100
      : null

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Montant total (€)" name="totalAmount">
          <AmountInput name="totalAmount" placeholder="1 000" onValueChange={setTotal} />
        </Field>
        <Field label="Nombre d’échéances" name="installmentsTotal">
          <Input
            name="installmentsTotal"
            inputMode="numeric"
            placeholder="4"
            value={count}
            onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
      </div>

      {manual ? (
        <Field label="Montant d’une échéance (€)" name="installmentAmount">
          <AmountInput name="installmentAmount" defaultValue={derived !== null ? derived.toFixed(2) : ''} />
        </Field>
      ) : (
        <p className="text-[11.5px] text-faint">
          {derived !== null ? (
            <>
              Soit <span className="font-mono text-muted-foreground tabular">{eur(derived, 2)}</span> par
              échéance.{' '}
            </>
          ) : (
            'Le montant par échéance sera la division du total. '
          )}
          <button
            type="button"
            onClick={() => setManual(true)}
            className="cursor-pointer text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
          >
            Ajuster
          </button>{' '}
          si les échéances ne sont pas toutes égales.
        </p>
      )}
    </>
  )
}
