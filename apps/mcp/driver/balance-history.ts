import { eur, type Steps } from '@abacus/use-case-language'
import type { McpContext } from './context.ts'

export function balanceHistorySteps({ call }: McpContext): Partial<Steps> {
  return {
    async readBalanceAcrossTheMonth(account) {
      const { days } = await call<{ days: { day: string; balance: string }[] }>('get_balance_history', {
        account,
      })
      const point = (p: { day: string; balance: string } | undefined) => {
        if (!p) throw new Error(`no balance history for "${account}"`)
        return { on: p.day, balance: eur(p.balance) }
      }
      return { first: point(days[0]), last: point(days.at(-1)) }
    },
  }
}
