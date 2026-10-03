'use client'

import type { RankingView } from '@abacus/core/domain'
import { useOptimistic, useState, useTransition } from 'react'
import { PreferenceRow } from '@/components/preference-row'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { setRankingViewPreferenceAction } from '@/lib/actions'

const LABEL: Record<RankingView, string> = { strip: 'Ruban', bars: 'Barres' }

/** Shares of an illustrative ranking, largest first, as the Analyse draws one. */
const SHARES = [36, 22, 15, 10, 7]

/**
 * The two drawings in miniature, with the same marks as the Analyse: shares
 * of one copper strip separated by 2 px, with a faint rest, or one copper bar
 * per line. The drawing says what the words « ruban » and « barres » cannot.
 */
function Miniature({ view }: { view: RankingView }) {
  if (view === 'strip')
    return (
      <div aria-hidden className="flex h-3 w-56 max-w-full gap-0.5">
        {SHARES.map((share) => (
          <span key={share} className="rounded-[2px] bg-chart-1" style={{ flexGrow: share }} />
        ))}
        <span
          className="rounded-[2px] bg-faint/40"
          style={{ flexGrow: 100 - SHARES.reduce((a, b) => a + b) }}
        />
      </div>
    )
  return (
    <div aria-hidden className="flex w-56 max-w-full flex-col gap-1">
      {SHARES.slice(0, 4).map((share) => (
        <span
          key={share}
          className="h-1.5 rounded-full bg-chart-1"
          style={{ width: `${(share / SHARES[0]!) * 100}%` }}
        />
      ))}
    </div>
  )
}

/**
 * How the Analyse screen draws its ranking. Sent on the change, without a
 * form, for the same reason as the reading beside it (`ReadingPreference`).
 */
export function RankingViewPreference({ value }: { value: RankingView }) {
  const [pending, startTransition] = useTransition()
  const [failed, setFailed] = useState<string | null>(null)
  const [view, showView] = useOptimistic(value)

  return (
    <PreferenceRow
      label="Classement de l’Analyse"
      example={<Miniature view={view} />}
      control={
        <div className="flex flex-col items-start gap-1.5 sm:items-end">
          <Tabs
            value={view}
            onValueChange={(chosen) =>
              startTransition(async () => {
                showView(chosen as RankingView)
                setFailed(await setRankingViewPreferenceAction(chosen))
              })
            }
          >
            <TabsList aria-label="Classement de l’Analyse">
              {(['strip', 'bars'] as const).map((option) => (
                <TabsTrigger key={option} value={option} disabled={pending} className="px-3 text-[12.5px]">
                  {LABEL[option]}
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
