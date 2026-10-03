'use client'

import { useId, useState } from 'react'
import { Field } from '@/components/forms'
import { fold } from '@/components/master-detail'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/**
 * Free text with what already exists proposed under it. A label typed again by
 * hand drifts (« Loisir », « loisirs », « Loisirs ») and every variant becomes
 * its own group; proposing the existing ones makes reusing a label one key
 * away, while a new one is still just typed.
 *
 * Built on a popover rather than a native datalist, which ignores the theme and
 * cannot be styled or read the same way in every browser.
 */
export function SuggestField({
  name,
  label,
  suggestions,
  defaultValue = '',
  placeholder,
}: {
  name: string
  label: string
  /** The values already in use, offered as they are. */
  suggestions: string[]
  defaultValue?: string
  placeholder?: string
}) {
  const listId = useId()
  const [value, setValue] = useState(defaultValue)
  const [open, setOpen] = useState(false)
  // The proposal the arrows designated; none until they are used, so Enter
  // sends what was typed rather than the first proposal that contains it.
  const [active, setActive] = useState<number | null>(null)
  // Focusing a filled field shows every other value, to move the entry to
  // another group; typing narrows them.
  const [typed, setTyped] = useState(false)
  const term = typed ? fold(value.trim()) : ''
  // The value already in the field is not a suggestion: proposing it back
  // would only stand between the field and the next one.
  const matches = suggestions.filter((s) => s !== value && fold(s).includes(term))
  const showing = open && matches.length > 0

  const pick = (choice: string) => {
    setValue(choice)
    setOpen(false)
  }

  return (
    <Field label={label} name={name}>
      <Popover open={showing} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <Input
            name={name}
            value={value}
            placeholder={placeholder}
            autoComplete="off"
            role="combobox"
            aria-expanded={showing}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showing && active !== null ? `${listId}-${active}` : undefined}
            onChange={(e) => {
              setValue(e.target.value)
              setTyped(true)
              setActive(null)
              setOpen(true)
            }}
            onFocus={() => {
              setTyped(false)
              setActive(null)
              setOpen(true)
            }}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setOpen(true)
                setActive((i) => (i === null ? 0 : Math.min(i + 1, matches.length - 1)))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                // Up from the first proposal returns to what was typed.
                setActive((i) => (i === null || i === 0 ? null : i - 1))
              } else if (e.key === 'Enter' && showing && active !== null) {
                // Takes the designated proposal instead of sending the form.
                e.preventDefault()
                pick(matches[active] ?? value)
              } else if (e.key === 'Escape' && showing) {
                e.preventDefault()
                setOpen(false)
              }
            }}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          // Focus stays in the field: the list is read from it, not entered.
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="w-(--radix-popover-trigger-width) p-1"
        >
          <div
            id={listId}
            role="listbox"
            aria-label={label}
            className="flex max-h-56 flex-col overflow-y-auto"
          >
            {matches.map((choice, i) => (
              <div
                key={choice}
                id={`${listId}-${i}`}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                // mousedown, not click: the field's blur would close the list
                // before a click lands.
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(choice)
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'cursor-default rounded-sm px-2 py-1.5 text-[13px]',
                  i === active && 'bg-accent text-accent-foreground',
                )}
              >
                {choice}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </Field>
  )
}
