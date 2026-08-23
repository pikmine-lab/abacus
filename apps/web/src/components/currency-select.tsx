'use client'

import { FormSelect } from '@/components/forms'

/** Every ISO code the runtime knows, as a statement writes them: EUR first. */
const CURRENCIES = ['EUR', ...Intl.supportedValuesOf('currency').filter((c) => c !== 'EUR')].map((code) => ({
  value: code,
  label: code,
}))

/** Compact code picker sitting at the right of an amount input. */
export function CurrencySelect({
  name = 'currency',
  defaultValue = 'EUR',
  onValueChange,
}: {
  name?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
}) {
  return (
    <div className="w-[5.5rem] shrink-0">
      <FormSelect
        name={name}
        options={CURRENCIES}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
      />
    </div>
  )
}
