'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Money entry that groups thousands as you type: "2000000" reads back as
 * "2 000 000" before you have finished typing it, which is when a misplaced
 * zero is still cheap to notice.
 *
 * The visible field carries the formatted text and the form carries a plain
 * machine value in a hidden input, so the server never has to guess what a
 * space or a comma meant.
 */

/** Narrow no-break space, as toLocaleString('fr-FR') uses for groups. */
const GROUP = ' '

function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP)
}

interface Parts {
  negative: boolean
  integer: string
  decimals: string | null
}

/**
 * Keeps only digits and one decimal comma, capped at two decimals. A leading
 * minus survives where the caller allows one, and only there: nearly every
 * amount here is positive by construction, a balance is the exception.
 */
function normalizeTyped(raw: string, negatable = false): Parts {
  const negative = negatable && raw.trimStart().startsWith('-')
  const cleaned = raw.replace(/[^\d,.]/g, '').replace(/\./g, ',')
  const [first, ...rest] = cleaned.split(',')
  const integer = (first ?? '').replace(/^0+(?=\d)/, '')
  if (rest.length === 0) return { negative, integer, decimals: null }
  return { negative, integer, decimals: rest.join('').slice(0, 2) }
}

function format({ negative, integer, decimals }: Parts): string {
  const sign = negative ? '-' : ''
  const head = groupDigits(integer)
  if (decimals === null) return `${sign}${head}`
  return `${sign}${head === '' ? '0' : head},${decimals}`
}

function toMachine({ negative, integer, decimals }: Parts): string {
  if (integer === '' && !decimals) return ''
  return `${negative ? '-' : ''}${integer === '' ? '0' : integer}${decimals ? `.${decimals}` : ''}`
}

/** How many digits sit left of the caret, the anchor a reformat must preserve. */
function digitsBefore(value: string, caret: number): number {
  return (value.slice(0, caret).match(/\d/g) ?? []).length
}

function caretAfterDigits(formatted: string, count: number): number {
  if (count === 0) return 0
  let seen = 0
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i]!)) {
      seen++
      if (seen === count) return i + 1
    }
  }
  return formatted.length
}

export function AmountInput({
  name,
  defaultValue = '',
  className,
  negatable,
  onValueChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'name' | 'defaultValue' | 'value' | 'onChange'> & {
  name: string
  /** Plain number as text, e.g. "15.99". */
  defaultValue?: string | number
  /** Lets a leading minus through, for the balance of an overdrawn account. */
  negatable?: boolean
  /** Receives the machine value ("2000000.55"), for callers that react to it. */
  onValueChange?: (value: string) => void
}) {
  const initial = normalizeTyped(String(defaultValue).replace('.', ','), negatable)
  const [text, setText] = useState(() => format(initial))
  const parts = normalizeTyped(text, negatable)

  return (
    <>
      <input type="hidden" name={name} value={toMachine(parts)} />
      <Input
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          const field = e.target
          const raw = field.value
          const typedCaret = field.selectionStart ?? raw.length
          const next = format(normalizeTyped(raw, negatable))
          // Typing at the end stays at the end. Counting digits alone would put
          // the caret before a just-typed decimal comma, and the next keystroke
          // would land on the wrong side of it.
          const caret =
            typedCaret >= raw.length ? next.length : caretAfterDigits(next, digitsBefore(raw, typedCaret))
          setText(next)
          onValueChange?.(toMachine(normalizeTyped(next, negatable)))
          // Write the formatted value and the caret straight away: React then
          // re-renders the same string, so the caret is never pushed to the end.
          field.value = next
          field.setSelectionRange(caret, caret)
        }}
        className={cn('text-right font-mono tabular', className)}
        {...props}
      />
    </>
  )
}
