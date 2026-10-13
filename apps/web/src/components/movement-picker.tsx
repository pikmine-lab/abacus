'use client'

import { matchesSearch, searchTerms } from '@abacus/core/domain/search'
import { useTranslations } from 'next-intl'
import { useEffect, useId, useRef, useState } from 'react'
import type { LinkChoice } from '@/components/advance-links'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/**
 * Picks the movement a link points at, by typing what is remembered of it. A
 * link is made to one precise movement, often an old one: a fixed list made
 * the reader scan it by eye, and could only ever hold the latest few. The
 * field is the search itself, its proposals open under it, or above when the
 * room is there; they come from the whole history, searched the way the
 * ledger is (`searchTerms`: each word found somewhere, an amount by its first
 * digits). Before anything is typed, it proposes what is in use: the claims
 * awaited, then the latest movements.
 *
 * Once something is typed, every movement proposed comes from that search, so
 * one rule decides what matches. The claims and the commitments are not
 * movements and the server does not search them: they are matched here by the
 * same rule (`matchesSearch`), on their names and amounts.
 * Picking writes the movement's name in the field; typing again drops it.
 */
export function MovementPicker({
  name,
  label,
  side,
  claims = [],
  commitments = [],
  recent,
  placeholder,
  onValueChange,
}: {
  name: string
  /** Names the list for assistive technologies; the visible label is the Field's. */
  label: string
  /** What is searched on the server: the expenses an income pays back, or the incomes an expense was paid back by. */
  side: 'expense' | 'income'
  /** The claims awaited, on top: what an income most often pays back. */
  claims?: LinkChoice[]
  /** The running commitments an income may have been received for, after the movements. */
  commitments?: LinkChoice[]
  /** The latest movements, valued as the search values them, proposed until something is typed. */
  recent: LinkChoice[]
  placeholder: string
  onValueChange?: (value: string) => void
}) {
  const t = useTranslations('movements.links')
  const listId = useId()
  const field = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<LinkChoice | null>(null)
  const [open, setOpen] = useState(false)
  // The proposal the arrows designated; none until they are used.
  const [active, setActive] = useState<number | null>(null)
  const [hits, setHits] = useState<LinkChoice[]>([])
  const [searching, setSearching] = useState(false)
  // A picked movement's name is in the field, but it is not a search.
  const term = picked ? '' : text.trim()

  useEffect(() => {
    if (!term) {
      setHits([])
      setSearching(false)
      return
    }
    setSearching(true)
    // Wait for a pause in typing, and let a newer keystroke abort the request
    // its predecessor started.
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/movements/links?side=${side}&q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        })
        setHits(response.ok ? await response.json() : [])
        setSearching(false)
        // The designated proposal belonged to the previous list.
        setActive(null)
      } catch {
        // Aborted, the newer request owns the state; offline, say nothing found.
        if (!controller.signal.aborted) {
          setHits([])
          setSearching(false)
        }
      }
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [term, side])

  const terms = searchTerms(term)
  const groups = [
    {
      label: t('groupClaims'),
      options: claims.filter((c) =>
        matchesSearch(terms, c.search?.texts ?? [c.label], c.search?.amounts ?? []),
      ),
    },
    {
      label: term ? t('groupFound') : t(side === 'expense' ? 'groupExpenses' : 'groupIncomes'),
      options: term ? hits : recent,
    },
    {
      label: t('groupCommitments'),
      options: commitments.filter((c) =>
        matchesSearch(terms, c.search?.texts ?? [c.label], c.search?.amounts ?? []),
      ),
    },
  ].filter((group) => group.options.length > 0)
  const options = groups.flatMap((group) => group.options)
  const status = options.length > 0 ? null : searching ? t('searching') : term ? t('nothingFound') : null
  const showing = open && (options.length > 0 || status !== null)

  const pick = (choice: LinkChoice) => {
    setPicked(choice)
    setText(choice.label)
    setOpen(false)
    setActive(null)
    onValueChange?.(choice.value)
  }

  return (
    <>
      <input type="hidden" name={name} value={picked?.value ?? ''} />
      <Popover open={showing} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <Input
            ref={field}
            value={text}
            placeholder={placeholder}
            autoComplete="off"
            role="combobox"
            aria-expanded={showing}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showing && active !== null ? `${listId}-${active}` : undefined}
            onChange={(e) => {
              setText(e.target.value)
              setActive(null)
              setOpen(true)
              if (picked) {
                setPicked(null)
                onValueChange?.('')
              }
            }}
            onFocus={(e) => {
              // A picked name is selected whole, so typing replaces it.
              if (picked) e.target.select()
              setOpen(true)
            }}
            onClick={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setOpen(true)
                setActive((i) => (i === null ? 0 : Math.min(i + 1, options.length - 1)))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((i) => (i === null || i === 0 ? null : i - 1))
              } else if (e.key === 'Enter' && showing) {
                // Never sends the form from the search: Enter takes the
                // designated proposal, or the only one there is.
                e.preventDefault()
                const choice =
                  active !== null ? options[active] : options.length === 1 ? options[0] : undefined
                if (choice) pick(choice)
              } else if (e.key === 'Escape' && showing) {
                // Closes the list, not the panel around it.
                e.preventDefault()
                e.stopPropagation()
                setOpen(false)
              }
            }}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          // Focus stays in the field: the list is read from it, not entered.
          onOpenAutoFocus={(e) => e.preventDefault()}
          // The field is outside the list but part of it: pressing in it is
          // not leaving, and would otherwise close the list it just opened.
          onInteractOutside={(e) => {
            if (field.current?.contains(e.target as Node)) e.preventDefault()
          }}
          className="w-(--radix-popover-trigger-width) min-w-80 p-1"
        >
          <div
            id={listId}
            role="listbox"
            aria-label={label}
            className="flex max-h-72 flex-col overflow-y-auto"
          >
            {status && <p className="px-2 py-3 text-center text-[12px] text-muted-foreground">{status}</p>}
            {groups.map((group) => (
              // biome-ignore lint/a11y/useSemanticElements: a group of options inside a listbox is role="group" (ARIA listbox pattern); a fieldset belongs to forms
              <div key={group.label} role="group" aria-label={group.label} className="flex flex-col">
                <p className="px-2 pt-1.5 pb-1 text-[11px] text-faint">{group.label}</p>
                {group.options.map((choice) => {
                  const i = options.indexOf(choice)
                  return (
                    <div
                      key={choice.value}
                      id={`${listId}-${i}`}
                      role="option"
                      tabIndex={-1}
                      aria-selected={i === active}
                      // mousedown, not click: the field's blur would close the
                      // list before a click lands.
                      onMouseDown={(e) => {
                        e.preventDefault()
                        pick(choice)
                      }}
                      onMouseEnter={() => setActive(i)}
                      className={cn(
                        'cursor-default truncate rounded-sm px-2 py-1.5 text-[13px]',
                        i === active && 'bg-accent text-accent-foreground',
                      )}
                    >
                      {choice.label}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}
