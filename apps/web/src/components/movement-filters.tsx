'use client'

import { SearchIcon, XIcon } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toggle } from '@/components/ui/toggle'

interface Option {
  id: string
  name: string
}

const ALL = '__all__'

const KINDS = [
  { value: 'all', label: 'Tous' },
  { value: 'expense', label: 'Dépenses' },
  { value: 'income', label: 'Revenus' },
  { value: 'transfer', label: 'Virements' },
]

/**
 * The dimension filters, on one row under the period. Everything is written to
 * the URL so the server does the filtering, a filtered view is shareable, and
 * the back button undoes a filter like it undoes a page.
 */
export function MovementFilters({
  accounts,
  categories,
  actors,
  activities,
}: {
  accounts: Option[]
  categories: Option[]
  actors: Option[]
  activities: Option[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [term, setTerm] = useState(searchParams.get('q') ?? '')

  function push(mutate: (params: URLSearchParams) => void, replace = false) {
    const params = new URLSearchParams(searchParams)
    mutate(params)
    const url = `${pathname}${params.size ? `?${params}` : ''}`
    if (replace) router.replace(url, { scroll: false })
    else router.push(url, { scroll: false })
  }

  // Typing must not cost a history entry nor a request per keystroke. The
  // timer is debounced on the handler rather than in an effect: the URL is
  // written as a reaction to input, not synchronised with render.
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined)
  function onSearch(value: string) {
    setTerm(value)
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      push((p) => (value ? p.set('q', value) : p.delete('q')), true)
    }, 350)
  }
  useEffect(() => () => clearTimeout(debounce.current), [])

  const set = (key: string) => (value: string) =>
    push((p) => (value === ALL ? p.delete(key) : p.set(key, value)))

  const dimensions = [
    { key: 'account', label: 'Tous les comptes', options: accounts },
    { key: 'category', label: 'Toutes catégories', options: categories },
    { key: 'actor', label: 'Tous les acteurs', options: actors },
    { key: 'activity', label: 'Toutes activités', options: activities },
  ].filter((d) => d.options.length > 0)

  const active = ['account', 'category', 'actor', 'activity', 'q', 'type', 'advances'].filter((k) =>
    searchParams.get(k),
  )

  return (
    <>
      <Tabs
        value={searchParams.get('type') ?? 'all'}
        onValueChange={(v) => push((p) => (v === 'all' ? p.delete('type') : p.set('type', v)))}
      >
        <TabsList className="h-7">
          {KINDS.map((k) => (
            <TabsTrigger key={k.value} value={k.value} className="px-2 text-[12px]">
              {k.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint" />
        <Input
          value={term}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Acteur ou note…"
          aria-label="Rechercher"
          className="h-7 w-44 pl-7 text-[12.5px]"
        />
      </div>

      {dimensions.map((d) => {
        // A value the options do not contain (stale link, deleted entity) would
        // render an empty trigger; the server ignores it, so does the control.
        const raw = searchParams.get(d.key)
        const value = raw && d.options.some((o) => o.id === raw) ? raw : ALL
        return (
          <Select key={d.key} value={value} onValueChange={set(d.key)}>
            <SelectTrigger size="sm" className="h-7 text-[12.5px]" aria-label={d.label}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{d.label}</SelectItem>
              {d.options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      })}

      <Toggle
        size="sm"
        pressed={searchParams.get('advances') === '1'}
        onPressedChange={(on) => push((p) => (on ? p.set('advances', '1') : p.delete('advances')))}
        className="h-7 px-2 text-[12px] font-normal text-faint data-[state=on]:text-primary"
      >
        Avances en attente
      </Toggle>

      {active.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[12px] text-muted-foreground"
          onClick={() =>
            push((p) => {
              for (const key of ['account', 'category', 'actor', 'activity', 'q', 'type', 'advances'])
                p.delete(key)
            })
          }
        >
          <XIcon className="size-3.5" />
          Effacer ({active.length})
        </Button>
      )}
    </>
  )
}
