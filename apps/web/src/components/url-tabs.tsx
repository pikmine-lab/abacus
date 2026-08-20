'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * A segmented control backed by one URL parameter. Exclusive choices that
 * change what the server queries belong in the URL, not in client state.
 */
export function UrlTabs({
  param,
  options,
  fallback,
  ariaLabel,
}: {
  param: string
  options: { value: string; label: string }[]
  /** Value meant by an absent parameter; selecting it removes the parameter. */
  fallback: string
  ariaLabel: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  return (
    <Tabs
      value={searchParams.get(param) ?? fallback}
      onValueChange={(v) => {
        const params = new URLSearchParams(searchParams)
        if (v === fallback) params.delete(param)
        else params.set(param, v)
        router.push(`${pathname}${params.size ? `?${params}` : ''}`, { scroll: false })
      }}
    >
      <TabsList className="h-7" aria-label={ariaLabel}>
        {options.map((o) => (
          <TabsTrigger key={o.value} value={o.value} className="px-2 text-[12px]">
            {o.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
