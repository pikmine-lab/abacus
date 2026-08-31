'use client'

import type { Reading } from '@abacus/core/domain'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useOptimistic, useTransition } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

/** The two ways a month can be counted, named on every screen that shows flows. */
export const READING_LABEL: Record<Reading, string> = {
  cash: 'Date réelle',
  accrual: 'Mois concerné',
}

/**
 * Which month the figures below count a movement in: the day the money moved,
 * or the month the movement is about. The same control on every screen that
 * shows period flows, because two screens disagreeing on August for a reason
 * nobody can see is worse than having only one reading.
 *
 * It never reaches a balance. A balance is the money sitting on the account
 * that day, so it has one reading and this control does not apply to it.
 *
 * A switch writes the URL and nothing else. The proxy turns that parameter
 * into the cookie that carries the choice to the next screen, and drops that
 * cookie on the next page load, so the switch lasts the visit while the URL
 * keeps this screen shareable and undoable. It never writes the profile, which
 * is settled in Réglages and nowhere else (lib/reading.ts, proxy.ts).
 */
export function ReadingTabs({ value }: { value: Reading }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()
  // The tab moves while the navigation travels, and falls back to the server's
  // answer on its own once it lands.
  const [reading, showReading] = useOptimistic(value)

  return (
    <Tabs
      value={reading}
      onValueChange={(chosen) =>
        startTransition(() => {
          showReading(chosen as Reading)
          const params = new URLSearchParams(searchParams)
          // Always written out, never dropped on the default: an absent
          // parameter hands the screen back to the cookie, and the URL is what
          // makes this framing shareable and undoable.
          params.set('reading', chosen)
          router.push(`${pathname}?${params}`, { scroll: false })
        })
      }
    >
      <TabsList className="h-7" aria-label="Mois compté">
        {(['cash', 'accrual'] as const).map((option) => (
          <TabsTrigger key={option} value={option} className="px-2 text-[12px]">
            {READING_LABEL[option]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
