import { UrlTabs } from '@/components/url-tabs'
import { type ChartWindow, WINDOW_LABEL } from '@/lib/chart-window'

const WINDOWS: ChartWindow[] = ['1w', '1m', '1y', 'all']

/**
 * How far back the curve it sits on is drawn. It belongs to its chart, not to
 * the page: it is placed on the section it scopes, and the durations are the
 * ones a brokerage screen uses, because that is where this reading is learnt.
 */
export function WindowTabs() {
  return (
    <UrlTabs
      param="window"
      fallback="all"
      ariaLabel="Fenêtre du graphe"
      options={WINDOWS.map((w) => ({ value: w, label: WINDOW_LABEL[w] }))}
    />
  )
}
