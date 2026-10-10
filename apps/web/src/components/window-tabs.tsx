import { useTranslations } from 'next-intl'
import { UrlTabs } from '@/components/url-tabs'
import { WINDOWS } from '@/lib/chart-window'

/**
 * How far back the curve it sits on is drawn. It belongs to its chart, not to
 * the page: it is placed on the section it scopes, and the durations are the
 * ones a brokerage screen uses, because that is where this reading is learnt.
 */
export function WindowTabs() {
  const t = useTranslations('investments.window')
  return (
    <UrlTabs
      param="window"
      fallback="all"
      ariaLabel={t('label')}
      options={WINDOWS.map((w) => ({ value: w, label: t(`options.${w}`) }))}
    />
  )
}
