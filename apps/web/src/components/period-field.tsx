'use client'

import { Field, FormSelect } from '@/components/forms'

/**
 * How often a commitment falls, asked as one question rather than as a unit
 * and a multiple to combine: these are the rhythms things are actually billed
 * at. The value travels as "unit:count", which the server action splits back.
 */
const PERIODS = [
  { value: 'week:1', label: 'chaque semaine' },
  { value: 'week:2', label: 'toutes les 2 semaines' },
  { value: 'week:4', label: 'toutes les 4 semaines' },
  { value: 'month:1', label: 'chaque mois' },
  { value: 'month:2', label: 'tous les 2 mois' },
  { value: 'month:3', label: 'tous les 3 mois' },
  { value: 'month:6', label: 'tous les 6 mois' },
  { value: 'year:1', label: 'chaque année' },
  { value: 'year:2', label: 'tous les 2 ans' },
]

const PLURAL: Record<string, string> = { week: 'semaines', month: 'mois', year: 'ans' }

/**
 * The list covers what a commitment is normally billed at, but the MCP accepts
 * any multiple: one declared there keeps its own rhythm in the list instead of
 * being silently rewritten by the first correction.
 */
function optionsFor(value: string) {
  if (PERIODS.some((p) => p.value === value)) return PERIODS
  const [unit, count] = value.split(':')
  return [...PERIODS, { value, label: `toutes les ${count} ${PLURAL[unit ?? 'month']}` }]
}

export function PeriodField({
  defaultValue,
  onValueChange,
}: {
  defaultValue: string
  /** For callers deriving from it, such as a schedule preview. */
  onValueChange?: (value: string) => void
}) {
  return (
    <Field label="Périodicité" name="period">
      <FormSelect
        name="period"
        defaultValue={defaultValue}
        options={optionsFor(defaultValue)}
        onValueChange={onValueChange}
      />
    </Field>
  )
}
