'use client'

import type { RankingView } from '@abacus/core/domain'
import { useOptimistic, useState, useTransition } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { setRankingViewPreferenceAction } from '@/lib/actions'

const LABEL: Record<RankingView, string> = { strip: 'Ruban', bars: 'Barres' }

/**
 * How the Analyse screen draws its ranking. Sent on the change, without a
 * form, for the same reason as the reading beside it (`ReadingPreference`).
 */
export function RankingViewPreference({ value }: { value: RankingView }) {
  const [pending, startTransition] = useTransition()
  const [failed, setFailed] = useState<string | null>(null)
  const [view, showView] = useOptimistic(value)

  return (
    <div className="flex items-center gap-2">
      <Tabs
        value={view}
        onValueChange={(chosen) =>
          startTransition(async () => {
            showView(chosen as RankingView)
            setFailed(await setRankingViewPreferenceAction(chosen))
          })
        }
      >
        <TabsList className="h-7" aria-label="Classement de l’Analyse">
          {(['strip', 'bars'] as const).map((option) => (
            <TabsTrigger key={option} value={option} disabled={pending} className="px-2 text-[12px]">
              {LABEL[option]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {failed && <span className="text-[11px] text-destructive">{failed}</span>}
    </div>
  )
}
