import { UrlTabs } from '@/components/url-tabs'

/**
 * Which month the figures below count a movement in: the day the money moved,
 * or the month the movement is about. The same control on every screen that
 * shows period flows, because two screens disagreeing on August for a reason
 * nobody can see is worse than having only one reading.
 *
 * It never reaches a balance. A balance is the money sitting on the account
 * that day, so it has one reading and this control does not apply to it.
 */
export function ReadingTabs() {
  return (
    <UrlTabs
      param="reading"
      fallback="cash"
      ariaLabel="Mois compté"
      options={[
        { value: 'cash', label: 'Date réelle' },
        { value: 'accrual', label: 'Mois concerné' },
      ]}
    />
  )
}
