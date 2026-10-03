'use client'

import type { Reading } from '@abacus/core/domain'
import { useOptimistic, useState, useTransition } from 'react'
import { PreferenceRow } from '@/components/preference-row'
import { READING_LABEL } from '@/components/reading-tabs'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { setReadingPreferenceAction } from '@/lib/actions'

/** The month a rent paid ahead lands in, under each reading. */
const COUNTED_IN: Record<Reading, string> = { cash: 'septembre', accrual: 'octobre' }

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
    <PreferenceRow
      label="Mois compté"
      // One case where the two readings disagree says more than a definition
      // of each: a rent paid on the last days of the month before.
      example={
        <p>
          Le loyer d’octobre, payé le 30 septembre, compte en{' '}
          <span className="font-medium text-foreground">{COUNTED_IN[reading]}</span>.
        </p>
      }
      control={
        <div className="flex flex-col items-start gap-1.5 sm:items-end">
          <Tabs
            value={reading}
            onValueChange={(chosen) =>
              startTransition(async () => {
                showReading(chosen as Reading)
                setFailed(await setReadingPreferenceAction(chosen))
              })
            }
          >
            <TabsList aria-label="Mois compté">
              {(['cash', 'accrual'] as const).map((option) => (
                <TabsTrigger key={option} value={option} disabled={pending} className="px-3 text-[12.5px]">
                  {READING_LABEL[option]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {failed && <span className="text-[11px] text-destructive">{failed}</span>}
        </div>
      }
    />
  )
}
