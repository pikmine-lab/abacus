import { eur, type Preferences, type Steps } from '@abacus/use-case-language'
import type { McpContext } from './context.ts'

const money = (value: number) => eur(value.toFixed(2))

/** The first and last day of a month, "YYYY-MM". */
function monthBounds(month: string): { from: string; to: string } {
  const [year, monthOfYear] = month.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(year, monthOfYear, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

type FlowRow = Record<string, string | number> & { gross?: number; net?: number; amount?: number }

export function reportingSteps({ call }: McpContext): Partial<Steps> {
  return {
    async readFlows({ kind, by, month }) {
      const { rows } = await call<{ rows: FlowRow[] }>('analyze_flows', {
        ...monthBounds(month),
        groupBy: by,
        kind,
      })
      return rows.map((row) => {
        const label = row[by] as string
        return {
          label: label === '(none)' ? null : label,
          amount: money((kind === 'expense' ? row.net : row.amount) ?? 0),
        }
      })
    },
    async readWealth() {
      const overview = await call<{ accounts: { balance: number }[]; holdings?: { value: number } }>(
        'get_overview',
        {},
      )
      const balances = overview.accounts.reduce((sum, a) => sum + a.balance, 0)
      return money(balances + (overview.holdings?.value ?? 0))
    },
    async readCommittedMonthlyCost() {
      return money((await call<{ monthlyCommittedCost: number }>('get_overview', {})).monthlyCommittedCost)
    },
    async readOccurrencesToConfirm() {
      const { pendingOccurrences } = await call<{ pendingOccurrences: { ahead?: string }[] }>(
        'get_overview',
        {},
      )
      return pendingOccurrences.filter((p) => !p.ahead).length
    },
    async readThresholdAlerts() {
      const { activityAlerts } = await call<{ activityAlerts?: { alert: string; about: string }[] }>(
        'get_overview',
        {},
      )
      return (activityAlerts ?? []).flatMap(
        ({ alert, about }): { about: string; state: 'crossed' | 'near' }[] =>
          alert === 'threshold_crossed'
            ? [{ about, state: 'crossed' }]
            : alert === 'threshold_near'
              ? [{ about, state: 'near' }]
              : [],
      )
    },
    async readPreferences() {
      return await call<Preferences>('manage_preferences', { action: 'show' })
    },
    async setReadingPreference(reading) {
      await call('manage_preferences', { action: 'update', reading })
    },
    async setRankingViewPreference(rankingView) {
      await call('manage_preferences', { action: 'update', rankingView })
    },
    async setLanguagePreference(language) {
      await call('manage_preferences', { action: 'update', language: language ?? 'browser' })
    },
  }
}
