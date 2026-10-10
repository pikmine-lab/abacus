'use client'

import { useTranslations } from 'next-intl'
import { Field, FormSelect } from '@/components/forms'

/**
 * How often a commitment falls, asked as one question rather than as a unit
 * and a multiple to combine: these are the rhythms things are actually billed
 * at. The value travels as "unit:count", which the server action splits back.
 */
const PERIODS = ['week:1', 'week:2', 'week:4', 'month:1', 'month:2', 'month:3', 'month:6', 'year:1', 'year:2']

type Unit = 'week' | 'month' | 'year'

/**
 * The list covers what a commitment is normally billed at, but the MCP accepts
 * any multiple: one declared there keeps its own rhythm in the list instead of
 * being silently rewritten by the first correction.
 */
function valuesFor(value: string): string[] {
  return PERIODS.includes(value) ? PERIODS : [...PERIODS, value]
}

export function PeriodField({
  defaultValue,
  onValueChange,
}: {
  defaultValue: string
  /** For callers deriving from it, such as a schedule preview. */
  onValueChange?: (value: string) => void
}) {
  const t = useTranslations('common.recurrence')
  const label = (value: string) => {
    const [unit = 'month', count = '1'] = value.split(':') as [Unit?, string?]
    return count === '1' ? t(`single.${unit}`) : t(`multiple.${unit}`, { count: Number(count) })
  }
  return (
    <Field label={t('label')} name="period">
      <FormSelect
        name="period"
        defaultValue={defaultValue}
        options={valuesFor(defaultValue).map((value) => ({ value, label: label(value) }))}
        onValueChange={onValueChange}
      />
    </Field>
  )
}
