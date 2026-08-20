'use client'

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { isNavigable, type Period, PRESET_LABEL, type Preset } from '@/lib/period'

const PRESETS: Preset[] = ['mois', 'annee', '90j', '12m', 'tout']

/**
 * The period control: presets plus arrows on the calendar ones. It writes to
 * the URL rather than to local state, so the scope is shareable, survives a
 * reload, and is read by the server components that do the querying.
 */
export function PeriodPicker({ period }: { period: Period }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function go(next: { periode?: Preset; ref?: string | null }) {
    const params = new URLSearchParams(searchParams)
    if (next.periode) params.set('periode', next.periode)
    if (next.ref === null) params.delete('ref')
    else if (next.ref !== undefined) params.set('ref', next.ref)
    router.push(`${pathname}?${params}`, { scroll: false })
  }

  const navigable = isNavigable(period.preset)
  return (
    <div className="flex flex-wrap items-center gap-2">
      {navigable && (
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Période précédente"
            onClick={() => go({ ref: period.prev })}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="min-w-[9.5rem] text-center text-[12.5px] font-medium">{period.label}</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Période suivante"
            disabled={period.next === null}
            onClick={() => period.next && go({ ref: period.next })}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      )}
      {!navigable && <span className="text-[12.5px] font-medium">{period.label}</span>}

      <Tabs
        value={period.preset}
        // Switching preset drops the old anchor: a month ref means nothing to
        // a year window, and resolvePeriod would fall back to today anyway.
        onValueChange={(v) => go({ periode: v as Preset, ref: null })}
      >
        <TabsList className="h-7">
          {PRESETS.map((p) => (
            <TabsTrigger key={p} value={p} className="px-2 text-[12px]">
              {PRESET_LABEL[p]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}
