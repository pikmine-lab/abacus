'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Field } from '@/components/forms'
import { Input } from '@/components/ui/input'
import { useFormat } from '@/lib/format'

/**
 * The share expected back, in euros or in percent of the expense: paying for
 * four and being owed three quarters is thought in percent, being owed one
 * item on a shared basket is thought in euros. Whichever is typed is the truth
 * and the other follows, so a corrected expense amount never rewrites what the
 * user actually stated.
 *
 * The form always carries euros: a percentage of an amount that later gets
 * corrected would silently move the claim.
 */
export function RefundShare({
  expense,
  defaultAmount,
  name = 'expectedRefundAmount',
  label,
  blank,
}: {
  expense: number
  defaultAmount?: number
  /** The field the euros travel in. */
  name?: string
  /** Names whose share it is, for a list of several. */
  label?: string
  /** Opens empty: the share of one person among several is never all of it. */
  blank?: boolean
}) {
  const t = useTranslations('movements.form')
  const format = useFormat()
  const [{ value, unit }, setShare] = useState<{ value: string; unit: 'eur' | 'pct' }>(
    defaultAmount !== undefined
      ? { value: format.editable(defaultAmount, 2), unit: 'eur' }
      : blank
        ? { value: '', unit: 'eur' }
        : { value: '100', unit: 'pct' },
  )

  const typed = value.trim() === '' ? 0 : format.parse(value)
  const usable = Number.isFinite(expense) && expense > 0 && Number.isFinite(typed)
  const euros = unit === 'eur' ? typed : usable ? Math.round(expense * typed) / 100 : Number.NaN
  const percent = unit === 'pct' ? typed : usable ? (typed / expense) * 100 : Number.NaN

  /** The value the user is not editing, without trailing zeros to fight the caret. */
  const mirror = format.editable

  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Empty stays empty: a row left blank states no share at all. */}
      <input type="hidden" name={name} value={value.trim() !== '' && Number.isFinite(euros) ? euros : ''} />
      <Field label={label ?? t('expectedShare')}>
        <Input
          inputMode="decimal"
          autoComplete="off"
          className="text-right font-mono tabular"
          value={unit === 'eur' ? value : mirror(euros, 2)}
          onChange={(e) => setShare({ value: e.target.value, unit: 'eur' })}
        />
      </Field>
      <Field label={t('orPercent')}>
        <Input
          inputMode="decimal"
          autoComplete="off"
          className="text-right font-mono tabular"
          value={unit === 'pct' ? value : mirror(percent, 1)}
          onChange={(e) => setShare({ value: e.target.value, unit: 'pct' })}
        />
      </Field>
    </div>
  )
}
