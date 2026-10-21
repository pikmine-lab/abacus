import { eur, type Steps } from '@abacus/use-case-language'
import { today } from '../src/domain/period.ts'
import { balanceSeries, firstDeclaredDay } from '../src/services/reports.ts'
import type { PreparationContext } from './context.ts'

export function balanceHistorySteps({ user, accountId }: PreparationContext): Partial<Steps> {
  return {
    async readBalanceAcrossTheMonth(account) {
      const id = await accountId(account)
      const now = today()
      const [y, m] = now.split('-').map(Number) as [number, number]
      const start = `${now.slice(0, 7)}-01`
      const first = await firstDeclaredDay(user.id)
      const from = first && first > start ? first : start
      const to = `${now.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
      const points = (await balanceSeries(user.id, from, to)).filter((p) => p.accountId === id)
      const point = (p: (typeof points)[number] | undefined) => {
        if (!p) throw new Error(`no balance history for "${account}"`)
        return { on: p.day, balance: eur(Number(p.balance).toFixed(2)) }
      }
      return { first: point(points[0]), last: point(points.at(-1)) }
    },
  }
}
