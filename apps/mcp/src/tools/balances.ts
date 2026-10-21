import { today } from '@abacus/core/domain/period'
import { balanceSeries, firstDeclaredDay } from '@abacus/core/services/reports'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { requireAccountByName } from '../resolve.ts'
import { fail, isoDate, ok, run } from './shared.ts'

/** The longest window one call answers: a year of days, leap day included. */
const MAX_DAYS = 366

const dayIndex = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000

/** The window the web home opens on: this month, from the first declared day when it is later. */
async function homeWindow(userId: string): Promise<{ from: string; to: string }> {
  const now = today()
  const [y, m] = now.split('-').map(Number) as [number, number]
  const monthStart = `${now.slice(0, 7)}-01`
  const monthEnd = `${now.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
  const first = await firstDeclaredDay(userId)
  return { from: first && first > monthStart ? first : monthStart, to: monthEnd }
}

export function registerBalanceTools(server: McpServer, userId: string): void {
  server.registerTool(
    'get_balance_history',
    {
      description:
        "The balance of one account, day by day, as the web home's chart draws it: what the account held on each day, its opening included, every movement up to that day counted on the day the money moved (a deferred card's purchase only once its statement is debited). Without from and to, the window the home opens on: this month, from the first declared day when it is later. At most 366 days per call. Amounts are decimal strings in the account's currency.",
      inputSchema: z.object({
        account: z.string().describe('The account, by name'),
        from: isoDate.optional().describe('YYYY-MM-DD, the first day. With to'),
        to: isoDate.optional().describe('YYYY-MM-DD, the last day, included. With from'),
      }),
    },
    async (a) =>
      run(async () => {
        const account = await requireAccountByName(userId, a.account)
        if ((a.from === undefined) !== (a.to === undefined)) return fail('Give both from and to, or neither.')
        const { from, to } = a.from && a.to ? { from: a.from, to: a.to } : await homeWindow(userId)
        if (from > to) return fail(`from (${from}) comes after to (${to}).`)
        if (dayIndex(to) - dayIndex(from) + 1 > MAX_DAYS)
          return fail(`At most ${MAX_DAYS} days per call: split ${from}..${to} in several calls.`)
        const points = await balanceSeries(userId, from, to)
        return ok({
          account: account.name,
          currency: account.currency,
          days: points
            .filter((p) => p.accountId === account.id)
            .map((p) => ({ day: p.day, balance: p.balance })),
        })
      }),
  )
}
