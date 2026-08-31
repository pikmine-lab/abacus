'use client'

import type { Reading } from '@abacus/core/domain'
import { useOptimistic, useState, useTransition } from 'react'
import { READING_LABEL } from '@/components/reading-tabs'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { setReadingPreferenceAction } from '@/lib/actions'

/**
 * The reading every session opens in, and the only place it is written. The
 * tabs of a screen switch the session; this settles what counting normally
 * means, which is why the two gestures do not live in the same place.
 *
 * Sent on the change, without a form around it: there is nothing else to fill
 * and no submit button, and React resetting a form once its action returns
 * would write the old value back over the new one.
 */
export function ReadingPreference({ value }: { value: Reading }) {
  const [pending, startTransition] = useTransition()
  const [failed, setFailed] = useState<string | null>(null)
  const [reading, showReading] = useOptimistic(value)

  return (
    <div className="flex items-center gap-2">
      <Tabs
        value={reading}
        onValueChange={(chosen) =>
          startTransition(async () => {
            showReading(chosen as Reading)
            setFailed(await setReadingPreferenceAction(chosen))
          })
        }
      >
        <TabsList className="h-7" aria-label="Mois compté">
          {(['cash', 'accrual'] as const).map((option) => (
            <TabsTrigger key={option} value={option} disabled={pending} className="px-2 text-[12px]">
              {READING_LABEL[option]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {failed && <span className="text-[11px] text-destructive">{failed}</span>}
    </div>
  )
}
