'use client'

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'

/**
 * The exercise an activity is read on. It is the activity's own fiscal year,
 * not the calendar period the rest of the app is scoped by: a regime settles
 * on its year and on nothing else, so this row carries no period control
 * beside it.
 *
 * It writes `year` to the URL like every other framing, so a statement is
 * shareable and the back button undoes the move.
 */
export function FiscalYearPicker({
  year,
  label,
  first,
  last,
}: {
  year: number
  /** How the year names itself: "exercice 2026", or its two dates. */
  label: string
  /** Oldest year worth opening: the one the activity started in. */
  first: number
  /** Newest: the running one, or the one the activity closed in. */
  last: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function go(next: number) {
    const params = new URLSearchParams(searchParams)
    if (next === last) params.delete('year')
    else params.set('year', String(next))
    router.push(`${pathname}${params.size ? `?${params}` : ''}`, { scroll: false })
  }

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label="Exercice précédent"
        disabled={year <= first}
        onClick={() => go(year - 1)}
      >
        <ChevronLeftIcon />
      </Button>
      <span className="min-w-[9.5rem] text-center text-[12.5px] font-medium">{label}</span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label="Exercice suivant"
        disabled={year >= last}
        onClick={() => go(year + 1)}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  )
}
