import { eur, type Steps } from '@abacus/use-case-language'
import { listAccounts } from '../src/services/accounts.ts'
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
