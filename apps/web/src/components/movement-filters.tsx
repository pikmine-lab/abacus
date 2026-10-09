'use client'

import { ListFilterIcon, SearchIcon, XIcon } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toggle } from '@/components/ui/toggle'
import { NONE } from '@/lib/utils'
import { UNSET_LABEL } from './breakdown-bars'

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

const FILTER_KEYS = ['account', 'category', 'actor', 'activity', 'q', 'type', 'advances']

/**
 * The filters of the ledger, in the row under the period. Everything is written
 * to the URL so the server does the filtering, a filtered view is shareable,
 * and the back button undoes a filter like it undoes a page.
 *
 * The search and the kind stay in the open, they are how a line is found. The
 * dimensions sit behind "Filtres", because laid out they took the first screen
 * of a phone before a single movement; what is in force shows as a chip, which
 * is also how it is removed.
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
  const ids = useId()

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

  // A category or an activity can also be absent, which is a selection of its
  // own: what is left to categorise, what belongs to no activity. Named as the
  // ranking of the analysis names it, since that is where one comes from. An
  // actor never is: every expense goes to one and every income comes from one.
  const dimensions = [
    { key: 'account', name: 'Compte', all: 'Tous les comptes', options: accounts },
    {
      key: 'category',
      name: 'Catégorie',
      all: 'Toutes catégories',
      options: categories,
      none: UNSET_LABEL.category,
    },
    { key: 'actor', name: 'Acteur', all: 'Tous les acteurs', options: actors },
    {
      key: 'activity',
      name: 'Activité',
      all: 'Toutes activités',
      options: activities,
      none: UNSET_LABEL.activity,
    },
  ].filter((d) => d.options.length > 0 || (d.none && searchParams.get(d.key) === NONE))

  // A value the options do not contain (stale link, deleted entity) would
  // render an empty trigger and a nameless chip; the server ignores it, so do
  // the controls.
  const chosen = dimensions.flatMap((d) => {
    const raw = searchParams.get(d.key)
    const name = d.none && raw === NONE ? d.none : d.options.find((o) => o.id === raw)?.name
    return name ? [{ key: d.key, label: `${d.name} : ${name}`, name }] : []
  })
  const advancesOnly = searchParams.get('advances') === '1'
  if (advancesOnly) chosen.push({ key: 'advances', label: 'Avances en attente', name: 'Avances en attente' })

  const active = FILTER_KEYS.some((k) => searchParams.get(k))

  return (
    <>
      <div className="relative min-w-0 flex-1 @2xl:w-56 @2xl:flex-none">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint" />
        <Input
          value={term}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Acteur ou note…"
          aria-label="Rechercher"
          className="h-7 w-full pl-7 text-[12.5px]"
        />
      </div>

      {/* When the header is narrow (a phone, or beside the docked panel) the
          kind takes a line of its own rather than scrolling out of sight; the
          search and the filters keep the line above, the chips go below. */}
      <Tabs
        value={searchParams.get('type') ?? 'all'}
        onValueChange={(v) => push((p) => (v === 'all' ? p.delete('type') : p.set('type', v)))}
        className="order-1 w-full @2xl:order-none @2xl:w-auto"
      >
        <TabsList className="h-7 w-full @2xl:w-auto">
          {KINDS.map((k) => (
            <TabsTrigger key={k.value} value={k.value} className="px-2 text-[12px]">
              {k.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {dimensions.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-[12px] font-normal">
              <ListFilterIcon className="size-3.5 text-faint" />
              Filtres
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="flex w-64 flex-col gap-3 p-3">
            {dimensions.map((d) => {
              const raw = searchParams.get(d.key)
              const value =
                raw && ((d.none && raw === NONE) || d.options.some((o) => o.id === raw)) ? raw : ALL
              return (
                <div key={d.key} className="flex flex-col gap-1.5">
                  <Label
                    htmlFor={`${ids}-${d.key}`}
                    className="text-[12px] font-normal text-muted-foreground"
                  >
                    {d.name}
                  </Label>
                  <Select value={value} onValueChange={set(d.key)}>
                    <SelectTrigger id={`${ids}-${d.key}`} size="sm" className="h-8 w-full text-[12.5px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>{d.all}</SelectItem>
                      {d.none && <SelectItem value={NONE}>{d.none}</SelectItem>}
                      {d.options.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )
            })}
            <Toggle
              variant="outline"
              size="sm"
              pressed={advancesOnly}
              onPressedChange={(on) => push((p) => (on ? p.set('advances', '1') : p.delete('advances')))}
              className="h-8 justify-start px-2 text-[12.5px] font-normal text-muted-foreground data-[state=on]:text-primary"
            >
              Avances en attente
            </Toggle>
          </PopoverContent>
        </Popover>
      )}

      {chosen.map((c) => (
        <Button
          key={c.key}
          variant="secondary"
          size="sm"
          onClick={() => push((p) => p.delete(c.key))}
          aria-label={`Retirer le filtre ${c.label}`}
          className="order-2 h-7 gap-1 pr-1.5 pl-2 text-[12px] font-normal @2xl:order-none"
        >
          {c.name}
          <XIcon className="size-3 text-faint" />
        </Button>
      ))}

      {active && (
        <Button
          variant="ghost"
          size="sm"
          className="order-2 h-7 gap-1 px-2 text-[12px] text-muted-foreground @2xl:order-none"
          onClick={() =>
            push((p) => {
              for (const key of FILTER_KEYS) p.delete(key)
            })
          }
        >
          Effacer
        </Button>
      )}
    </>
  )
}
