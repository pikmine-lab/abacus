'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * A segmented control backed by one URL parameter. Exclusive choices that
 * change what the server queries belong in the URL, not in client state.
 * `clears` names the parameters a new choice makes meaningless, dropped with
 * it. An option drawn by an icon keeps its name for assistive technologies and
 * shows it in a tooltip.
 */
export function UrlTabs({
  param,
  options,
  fallback,
  ariaLabel,
  clears = [],
}: {
  param: string
  options: { value: string; label: string; icon?: ReactNode }[]
  /** Value meant by an absent parameter; selecting it removes the parameter. */
  fallback: string
  ariaLabel: string
  clears?: string[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  return (
    <Tabs
      value={searchParams.get(param) ?? fallback}
      onValueChange={(v) => {
        const params = new URLSearchParams(searchParams)
        for (const p of clears) params.delete(p)
        if (v === fallback) params.delete(param)
        else params.set(param, v)
        router.push(`${pathname}${params.size ? `?${params}` : ''}`, { scroll: false })
      }}
    >
      <TabsList className="h-7" aria-label={ariaLabel}>
        {options.map((o) =>
          o.icon ? (
            // The tooltip hangs on the drawing, not on the tab: both write
            // `data-state`, and the tooltip's would hide which tab is active.
            <TabsTrigger key={o.value} value={o.value} aria-label={o.label} className="px-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center">{o.icon}</span>
                </TooltipTrigger>
                <TooltipContent>{o.label}</TooltipContent>
              </Tooltip>
            </TabsTrigger>
          ) : (
            <TabsTrigger key={o.value} value={o.value} className="px-2 text-[12px]">
              {o.label}
            </TabsTrigger>
          ),
        )}
      </TabsList>
    </Tabs>
  )
}
