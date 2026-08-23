'use client'

import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * The handful most statements are written in, pinned on top: a plain list of
 * ~180 codes has no overview and no useful sort (the country-selector problem,
 * measured by Baymard), and search alone still costs a keystroke for the
 * common case.
 */
const FREQUENT = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'CNY']

const NAMES = new Intl.DisplayNames('fr', { type: 'currency' })

interface Row {
  code: string
  name: string
}

function rows(): { frequent: Row[]; others: Row[] } {
  const all = Intl.supportedValuesOf('currency')
  const name = (code: string) => {
    try {
      return NAMES.of(code) ?? code
    } catch {
      return code
    }
  }
  return {
    frequent: FREQUENT.filter((c) => all.includes(c)).map((code) => ({ code, name: name(code) })),
    others: all.filter((c) => !FREQUENT.includes(c)).map((code) => ({ code, name: name(code) })),
  }
}

/** Accent- and case-insensitive, so "etats" finds "États-Unis". */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * Currency picker: a compact trigger showing the code, opening a searchable
 * list. Typing matches the code and the French name, the code first ("us"
 * ranks USD above "dollar australien"), because a statement gives the code
 * and memory gives the name.
 */
export function CurrencySelect({
  name = 'currency',
  value: controlled,
  defaultValue = 'EUR',
  onValueChange,
}: {
  name?: string
  /** Controlled: the caller owns the state (a form whose fields depend on it). */
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
}) {
  const [inner, setInner] = useState(defaultValue)
  const value = controlled ?? inner
  const [open, setOpen] = useState(false)
  const { frequent, others } = useMemo(rows, [])

  const pick = (code: string) => {
    setInner(code)
    setOpen(false)
    onValueChange?.(code)
  }

  const filter = (itemValue: string, search: string) => {
    const [code, ...words] = itemValue.split(' ')
    const term = fold(search)
    if (!term) return 1
    if (fold(code!).startsWith(term)) return 3
    const label = fold(words.join(' '))
    if (label.split(/[\s'’-]+/).some((word) => word.startsWith(term))) return 2
    if (label.includes(term)) return 1
    return 0
  }

  const group = (heading: string, list: Row[]) => (
    <CommandGroup heading={heading}>
      {list.map((row) => (
        <CommandItem key={row.code} value={`${row.code} ${row.name}`} onSelect={() => pick(row.code)}>
          <span className="w-10 shrink-0 font-mono text-[12px] tabular">{row.code}</span>
          <span className="truncate text-muted-foreground">{row.name}</span>
          {row.code === value && <CheckIcon className="ml-auto size-3.5" />}
        </CommandItem>
      ))}
    </CommandGroup>
  )

  return (
    <div className="w-[5.5rem] shrink-0">
      <input type="hidden" name={name} value={value} />
      {/* modal: the picker lives inside a Sheet, whose dialog sets
          pointer-events: none on the body; a non-modal popover inherits it
          through its portal and the list stops responding to the mouse. */}
      <Popover modal open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Devise"
            className="w-full justify-between px-2.5 font-mono text-[12.5px] font-normal"
          >
            {value}
            <ChevronDownIcon className="size-3.5 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-0">
          <Command filter={filter}>
            <CommandInput placeholder="Code ou nom (USD, dollar…)" />
            <CommandList>
              <CommandEmpty>Aucune devise ne correspond.</CommandEmpty>
              {group('Courantes', frequent)}
              {group('Toutes', others)}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
