'use client'

import type { Reading } from '@abacus/core/domain'
import { useTranslations } from 'next-intl'
import { useOptimistic, useState, useTransition } from 'react'
import { PreferenceRow } from '@/components/preference-row'
import { READINGS } from '@/components/reading-tabs'
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
  const t = useTranslations('common')
  const [pending, startTransition] = useTransition()
  const [failed, setFailed] = useState<string | null>(null)
  const [reading, showReading] = useOptimistic(value)

  return (
    <PreferenceRow
      label={t('reading.label')}
      // One case where the two readings disagree says more than a definition
      // of each: a rent paid on the last days of the month before, and the
      // month it lands in under each reading.
      example={
        <p>
          {t.rich('preferences.reading.example', {
            month: t(`preferences.reading.countedIn.${reading}`),
            strong: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
          })}
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
            <TabsList aria-label={t('reading.label')}>
              {READINGS.map((option) => (
                <TabsTrigger key={option} value={option} disabled={pending} className="px-3 text-[12.5px]">
                  {t(`reading.${option}`)}
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
