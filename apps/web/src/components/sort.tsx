'use client'

import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TableHead } from '@/components/ui/table'
import { nextSortValue, type Sorter } from '@/lib/sort'
import { cn } from '@/lib/utils'

/**
 * How a list is reordered. Two shapes, one behaviour: designating a criterion
 * orders on it in its own opening direction, and designating the one already
 * in force reverses it. The chevron says which way the list runs, and the
 * order goes into the URL, so it is shareable and the back button undoes it.
 *
 * The shape follows what the row carries. A list whose columns are already
 * aligned takes the control in its header, where a reader reaches for it. A
 * list of two-storey blocks (an account and its last check, a subscription and
 * its next occurrence) has no column to click, and the criteria worth sorting
 * on live in the sentence under the name: it takes a named control at the end
 * of its section header instead. Tabularising those screens to unify the
 * gesture would cost the judgment badge, the progress ring and the check
 * sentence their place, for a sort that would then lose the very criteria it
 * was wanted for.
 */
function useSortHref(): (param: string, value: string | undefined) => void {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  return (param, value) => {
    const params = new URLSearchParams(searchParams)
    if (value === undefined) params.delete(param)
    else params.set(param, value)
    // Never scrolls: a list reordered from the bottom of a page must not throw
    // the reader back to its top.
    router.push(`${pathname}${params.size ? `?${params}` : ''}`, { scroll: false })
  }
}

const WAY = { asc: 'croissant', desc: 'décroissant' } as const

function Chevron({ direction, dimmed }: { direction: 'asc' | 'desc'; dimmed?: boolean }) {
  const Icon = direction === 'asc' ? ArrowUpIcon : ArrowDownIcon
  return (
    <Icon
      aria-hidden
      className={cn('size-3 shrink-0', dimmed && 'opacity-0 transition-opacity group-hover/sort:opacity-40')}
    />
  )
}

/**
 * One criterion, as a button. The chevron only shows on the criterion in
 * force; the others reveal theirs on hover, which is what says a column can be
 * clicked at all without lining the header with arrows.
 */
export function SortButton<Field extends string>({
  sorter,
  field,
  label,
  className,
}: {
  sorter: Sorter<Field>
  field: Field
  /** What the column is called; also what the button announces. */
  label: string
  className?: string
}) {
  const go = useSortHref()
  const active = sorter.current.field === field
  const direction = active ? sorter.current.direction : sorter.fields[field]
  const next = active ? (direction === 'asc' ? 'desc' : 'asc') : direction
  return (
    <button
      type="button"
      onClick={() => go(sorter.param, nextSortValue(sorter, field))}
      aria-label={
        active
          ? `${label}, tri ${WAY[direction]}. Trier ${WAY[next]}`
          : `Trier par ${label}, ${WAY[direction]}`
      }
      className={cn(
        'group/sort inline-flex items-center gap-1 transition-colors hover:text-foreground',
        active && 'text-foreground',
        className,
      )}
    >
      {label}
      <Chevron direction={direction} dimmed={!active} />
    </button>
  )
}

/**
 * A sortable column of a real table. `aria-sort` belongs on the cell and is
 * only meaningful inside a table, which is why the flex-row lists below
 * announce their order on the button itself instead of faking table semantics.
 */
export function SortHead<Field extends string>({
  sorter,
  field,
  label,
  className,
}: {
  sorter: Sorter<Field>
  field: Field
  label: string
  className?: string
}) {
  const active = sorter.current.field === field
  return (
    <TableHead
      aria-sort={active ? (sorter.current.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={className}
    >
      {/* Right-aligned columns hang their chevron on the inner side, so the
          figures below keep a straight edge. */}
      <SortButton
        sorter={sorter}
        field={field}
        label={label}
        className={className?.includes('text-right') ? 'flex-row-reverse' : undefined}
      />
    </TableHead>
  )
}

/** The same criterion in a hand-built column header (the flex-row lists). */
export function SortColumn<Field extends string>({
  sorter,
  field,
  label,
  className,
  align = 'left',
}: {
  sorter: Sorter<Field>
  field: Field
  label: string
  className?: string
  align?: 'left' | 'right'
}) {
  return (
    <span className={cn('flex', align === 'right' ? 'justify-end' : 'justify-start', className)}>
      <SortButton
        sorter={sorter}
        field={field}
        label={label}
        className={align === 'right' ? 'flex-row-reverse' : undefined}
      />
    </span>
  )
}

/**
 * The named control, for a list with no columns to click. It says what the
 * list is ordered on without being read, which a bare chevron somewhere in a
 * block row could not.
 */
export function SortMenu<Field extends string>({
  sorter,
  options,
}: {
  sorter: Sorter<Field>
  options: { field: Field; label: string }[]
}) {
  const go = useSortHref()
  const current = options.find((o) => o.field === sorter.current.field)
  // A list with a single criterion has nothing to choose between: the control
  // is then the reversal itself, and a menu of one entry would be a step
  // asking to be opened for a choice that does not exist.
  if (options.length === 1) {
    const only = options[0]!
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => go(sorter.param, nextSortValue(sorter, only.field))}
        aria-label={`${only.label}, tri ${WAY[sorter.current.direction]}. Inverser`}
        className="h-7 gap-1 px-2 text-[12px] text-muted-foreground"
      >
        {only.label}
        <Chevron direction={sorter.current.direction} />
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[12px] text-muted-foreground">
          Trier : {current?.label ?? ''}
          <Chevron direction={sorter.current.direction} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((option) => {
          const active = option.field === sorter.current.field
          return (
            <DropdownMenuItem
              key={option.field}
              onSelect={() => go(sorter.param, nextSortValue(sorter, option.field))}
              className="justify-between gap-6 text-[12.5px]"
            >
              {option.label}
              {/* On the criterion in force, the chevron is also the way to
                  reverse it: selecting it again flips the list. */}
              {active && <Chevron direction={sorter.current.direction} />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
