'use client'

import type { PeriodUnit } from '@abacus/core/domain'
import { addPeriod } from '@abacus/core/domain/period'
import { PencilIcon, RotateCcwIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { CurrencySelect } from '@/components/currency-select'
import { DateField, Field } from '@/components/forms'
import { PeriodField } from '@/components/period-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFormat } from '@/lib/format'

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
function buildSchedule(total: number, count: number, firstDueOn: string, period: string): Line[] {
  const [unit, step] = period.split(':')
  const cents = Math.round(total * 100)
  const share = Math.floor(cents / count)
  const lines: Line[] = []
  let dueOn = firstDueOn
  for (let index = 0; index < count; index++) {
    const amount = index === count - 1 ? cents - share * (count - 1) : share
    lines.push({ dueOn, amount: (amount / 100).toFixed(2) })
    dueOn = addPeriod(dueOn, unit as PeriodUnit, Number(step))
  }
  return lines
}

export function FinancingAmountFields({
  today,
  fixedTotal,
  onPlanChange,
}: {
  today: string
  /**
   * A plan for an amount already known, a claim paid back over time: the
   * total is not asked, and one payment is a plan too.
   */
  fixedTotal?: number
  /** For a caller reading a share as a part of the total or of one installment. */
  onPlanChange?: (plan: { total: number; count: number }) => void
}) {
  const t = useTranslations('recurring.financing')
  const format = useFormat()
  const [total, setTotal] = useState(fixedTotal === undefined ? '' : fixedTotal.toFixed(2))
  const [count, setCount] = useState('')
  const [firstDueOn, setFirstDueOn] = useState(today)
  const [period, setPeriod] = useState('month:1')
  const [lines, setLines] = useState<Line[] | null>(null)
  // The whole plan is written in one currency: total, installments, preview.
  const [currency, setCurrency] = useState('EUR')
  const fmt = (value: number) => format.money(value, currency)

  const totalValue = Number(total)
  const countValue = Number(count)
  const canBuild =
    Number.isFinite(totalValue) &&
    totalValue > 0 &&
    Number.isInteger(countValue) &&
    countValue >= (fixedTotal === undefined ? 2 : 1)
  const preview = canBuild ? buildSchedule(totalValue, countValue, firstDueOn, period) : null

  const scheduled = lines
    ? lines.reduce((sum, line) => sum + Math.round((Number(line.amount) || 0) * 100), 0)
    : 0
  const gap = lines ? scheduled - Math.round(totalValue * 100) : 0

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {fixedTotal === undefined && (
          <Field label={t('totalAmount')} name="totalAmount">
            <div className="flex gap-2">
              <AmountInput
                name="totalAmount"
                placeholder={t('totalPlaceholder')}
                onValueChange={(value) => {
                  setTotal(value)
                  setLines(null)
                  onPlanChange?.({ total: Number(value), count: countValue })
                }}
              />
              <CurrencySelect onValueChange={(v) => setCurrency(v || 'EUR')} />
            </div>
          </Field>
        )}
        <Field label={t('installments')} name="installmentsTotal">
          <Input
            name="installmentsTotal"
            inputMode="numeric"
            placeholder="4"
            value={count}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '')
              setCount(digits)
              setLines(null)
              onPlanChange?.({ total: totalValue, count: Number(digits) })
            }}
          />
        </Field>
      </div>

      {/* The first date and the rhythm drive the generated schedule; each line
          can still move after. */}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('firstDue')} name="firstDueOn">
          <DateField
            name="firstDueOn"
            defaultValue={today}
            onValueChange={(day) => {
              setFirstDueOn(day)
              setLines(null)
            }}
          />
        </Field>
        <PeriodField
          defaultValue="month:1"
          onValueChange={(value) => {
            setPeriod(value)
            setLines(null)
          }}
        />
      </div>

      {lines === null ? (
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-faint">
          {preview ? (
            <span>
              {t.rich(
                preview[preview.length - 1]!.amount !== preview[0]!.amount ? 'summaryWithLast' : 'summary',
                {
                  count: preview.length,
                  each: fmt(Number(preview[0]!.amount)),
                  last: fmt(Number(preview[preview.length - 1]!.amount)),
                  from: format.date(preview[0]!.dueOn),
                  to: format.date(preview[preview.length - 1]!.dueOn),
                  amount: (chunks) => (
                    <span className="font-mono text-muted-foreground tabular">{chunks}</span>
                  ),
                },
              )}
            </span>
          ) : (
            <span>{t(fixedTotal === undefined ? 'hint' : 'hintFixedTotal')}</span>
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
              {t('adjust')}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-[11.5px] text-muted-foreground">{t('adjustHint')}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-[12px] text-muted-foreground"
              onClick={() => setLines(null)}
            >
              <RotateCcwIcon className="size-3.5" />
              {t('reset')}
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
                  aria-label={t('installmentAmount', { index: index + 1 })}
                  className="ml-auto h-7 w-28 text-[12.5px]"
                  onValueChange={(value) =>
                    setLines(lines.map((l, i) => (i === index ? { ...l, amount: value } : l)))
                  }
                />
              </div>
            ))}
          </div>

          <p className={`text-[11.5px] ${gap === 0 ? 'text-faint' : 'text-destructive'}`}>
            {t.rich(gap === 0 ? 'totalMatches' : gap > 0 ? 'totalOver' : 'totalUnder', {
              total: fmt(scheduled / 100),
              gap: fmt(Math.abs(gap) / 100),
              amount: (chunks) => <span className="font-mono tabular">{chunks}</span>,
            })}
          </p>
        </div>
      )}
    </>
  )
}
