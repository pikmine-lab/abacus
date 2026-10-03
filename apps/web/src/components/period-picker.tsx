'use client'

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { isNavigable, type Period, PRESET_LABEL, type Preset } from '@/lib/period'
import { cn } from '@/lib/utils'

// The presets one can pick. A bare range carried by a link is not one of them:
// it shows as its own label, and clicking any preset leaves it.
const PRESETS: Preset[] = ['month', 'year', '90d', '12m', 'all']

/**
 * Moves the period in the URL rather than in local state, so the scope is
 * shareable, survives a reload, and is read by the server components that do
 * the querying.
 */
function usePeriodNavigation() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  return (next: { period?: Preset; ref?: string | null }) => {
    const params = new URLSearchParams(searchParams)
    if (next.period) params.set('period', next.period)
    if (next.ref === null) params.delete('ref')
    else if (next.ref !== undefined) params.set('ref', next.ref)
    router.push(`${pathname}?${params}`, { scroll: false })
  }
}

/**
 * The period's name, with arrows on the calendar presets. As a heading it is
 * the title of a screen that reads everything over one period.
 */
export function PeriodStepper({ period, heading }: { period: Period; heading?: boolean }) {
  const go = usePeriodNavigation()
  const type = heading
    ? 'text-[19px] font-semibold tracking-tight sm:text-[22px]'
    : 'text-[12.5px] font-medium'
  if (!isNavigable(period.preset)) return <span className={type}>{period.label}</span>
  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        className={heading ? 'size-8' : 'size-7'}
        aria-label="Période précédente"
        onClick={() => go({ ref: period.prev })}
      >
        <ChevronLeftIcon />
      </Button>
      <span className={cn('text-center', type, heading ? 'min-w-[11rem]' : 'min-w-[9.5rem]')}>
        {period.label}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className={heading ? 'size-8' : 'size-7'}
        aria-label="Période suivante"
        disabled={period.next === null}
        onClick={() => period.next && go({ ref: period.next })}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  )
}

export function PresetTabs({ period }: { period: Period }) {
  const go = usePeriodNavigation()
  return (
    <Tabs
      value={period.preset}
      // Switching preset drops the old anchor: a month ref means nothing to
      // a year window, and resolvePeriod would fall back to today anyway.
      onValueChange={(v) => go({ period: v as Preset, ref: null })}
    >
      <TabsList className="h-7">
        {PRESETS.map((p) => (
          <TabsTrigger key={p} value={p} className="px-2 text-[12px]">
            {PRESET_LABEL[p]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
