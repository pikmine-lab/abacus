import { eur, type Steps } from '@abacus/use-case-language'
import { listAccounts } from '../src/services/accounts.ts'
import { activityAlerts } from '../src/services/activityAlerts.ts'
import {
  listCommitmentsWithProgress,
  monthlyEquivalentEur,
  pendingOccurrences,
} from '../src/services/commitments.ts'
import { holdingsValue } from '../src/services/investments.ts'
import {
  languagePreference,
  rankingViewPreference,
  readingPreference,
  setLanguagePreference,
  setRankingViewPreference,
  setReadingPreference,
} from '../src/services/preferences.ts'
import { spendingBreakdown, spendingByCategoryGroup } from '../src/services/reports.ts'
import type { PreparationContext } from './context.ts'
import { monthBounds } from './ledger.ts'

const money = (value: string | number) => eur(Number(value).toFixed(2))

export function reportingSteps({ user }: PreparationContext): Partial<Steps> {
  return {
    async readFlows({ kind, by, month }) {
      const { from, to } = monthBounds(month)
      const reading = await readingPreference(user.id)
      const rows =
        by === 'categoryGroup'
          ? await spendingByCategoryGroup(user.id, from, to, kind, reading)
          : await spendingBreakdown(user.id, from, to, by, kind, reading)
      return rows.map((r) => ({ label: r.label, amount: money(kind === 'expense' ? r.net : r.gross) }))
    },
    async readWealth() {
      const balances = (await listAccounts(user.id)).reduce((sum, a) => sum + Number(a.balance), 0)
      return money(balances + (await holdingsValue(user.id)).value)
    },
    async readCommittedMonthlyCost() {
      const running = (await listCommitmentsWithProgress(user.id)).filter(
        (c) => !c.cancelledOn && c.direction === 'outgoing' && c.kind !== 'investment_plan',
      )
      return money(running.reduce((sum, c) => sum + monthlyEquivalentEur(c), 0))
    },
    async readOccurrencesToConfirm() {
      return (await pendingOccurrences(user.id)).filter((p) => !p.ahead).length
    },
    async readThresholdAlerts() {
      return (await activityAlerts(user.id)).flatMap(
        ({ kind, subject }): { about: string; state: 'crossed' | 'near' }[] =>
          kind === 'threshold_crossed'
            ? [{ about: subject, state: 'crossed' }]
            : kind === 'threshold_near'
              ? [{ about: subject, state: 'near' }]
              : [],
      )
    },
    async readPreferences() {
      return {
        reading: await readingPreference(user.id),
        rankingView: await rankingViewPreference(user.id),
        language: await languagePreference(user.id),
      }
    },
    async setReadingPreference(reading) {
      await setReadingPreference(user.id, reading)
    },
    async setRankingViewPreference(view) {
      await setRankingViewPreference(user.id, view)
    },
    async setLanguagePreference(language) {
      await setLanguagePreference(user.id, language)
    },
  }
}
