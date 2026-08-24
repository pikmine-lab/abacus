import { listAccounts } from '@abacus/core/services/accounts'
import { latestCheck } from '@abacus/core/services/balanceChecks'
import {
  listCommitmentsWithProgress,
  monthlyEquivalentEur,
  pendingOccurrences,
} from '@abacus/core/services/commitments'
import { holdingsValue } from '@abacus/core/services/investments'
import type { BreakdownRow } from '@abacus/core/services/reports'
import { spendingBreakdown, spendingByCategoryGroup } from '@abacus/core/services/reports'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { advancesView } from './movements.ts'
import { isoDate, ok, run } from './shared.ts'

export function registerOverviewTools(server: McpServer, userId: string): void {
  server.registerTool(
    'get_overview',
    {
      description:
        'The financial state, ready to reason about: balance per account with the freshness of its latest balance check, commitment occurrences awaiting confirmation, outstanding advances, and the committed monthly recurring cost. Start here when taking over without context, or to answer "where do I stand". Not for detailed history (list_movements) nor period analysis (analyze_spending).',
      inputSchema: z.object({}),
    },
    async () =>
      run(async () => {
        const accounts = await listAccounts(userId)
        const names = new Map(accounts.map((a) => [a.id, a.name]))
        const accountsView = await Promise.all(
          accounts.map(async (a) => {
            const check = await latestCheck(userId, a.id)
            return {
              name: a.name,
              behavior: a.behavior,
              closed: a.closedOn !== null,
              balance: Number(a.balance),
              lastCheck: check ? { on: check.check.checkedOn, gap: check.gap } : 'never checked',
            }
          }),
        )
        const pending = await pendingOccurrences(userId)
        const advances = await advancesView(userId)
        const commitments = (await listCommitmentsWithProgress(userId)).filter((c) => !c.cancelledOn)
        // In euros at the latest rate: a USD line added as-is would count
        // dollars as euros.
        const monthlyOut = commitments
          .filter((c) => c.direction === 'outgoing')
          .reduce((sum, c) => sum + monthlyEquivalentEur(c), 0)
        // An investment account's balance is its cash, so wealth is only whole
        // once the holdings are counted: what is worth stating is what those
        // add on top, at the last known price.
        const holdings = await holdingsValue(userId)
        return ok({
          accounts: accountsView,
          holdings:
            holdings.value > 0
              ? {
                  value: Math.round(holdings.value * 100) / 100,
                  method: 'positions at their last known price, on top of the account balances above',
                  unpricedPositions: holdings.unpriced === 0 ? undefined : holdings.unpriced,
                }
              : undefined,
          pendingOccurrences: pending.map((p) => ({
            commitment: p.commitment.label,
            dueOn: p.dueOn,
            amount: p.amount,
            // Absent on a euro commitment; the euros are computed at
            // confirmation, at the occurrence day's rate.
            ...(p.commitment.currency !== 'EUR' ? { currency: p.commitment.currency } : {}),
            direction: p.commitment.direction,
            // The account of its own date, which is not always the one the
            // commitment hits today: a move may have happened in between.
            account: names.get(p.accountId),
          })),
          outstandingAdvances: advances,
          monthlyCommittedCost: Math.round(monthlyOut * 100) / 100,
        })
      }),
  )

  server.registerTool(
    'analyze_spending',
    {
      description:
        'Breaks spending down over a period by category, actor, activity, or the group its categories belong to. Always returns two readings: gross (what actually left the accounts) and net (gross minus linked refunds actually received), plus the number of movements behind each row. Rows are ranked by net, biggest first, because the net is what the period actually cost: keep that order when reporting, it is the one the user sees on screen. Internal transfers never appear here, and neither do movements declared as ghost: that is exactly what the flag is for, so a total that looks short of a known movement is not a bug. Group by categoryGroup to answer "where does the money go, by big mass" in a handful of rows instead of the full category list: each mass also carries the categories it merges, already totalled and ranked, so drilling into one costs no second call and no addition of your own. Rows with no group (or no category) come back as "(none)". For freelance revenue, group by activity and look at incomes through list_movements (kind: income). A period can be read two ways (see reading): always tell the user which one the figures come from, because the same month has two legitimate totals.',
      inputSchema: z.object({
        from: isoDate,
        to: isoDate,
        groupBy: z.enum(['category', 'actor', 'activity', 'categoryGroup']),
        reading: z
          .enum(['cash', 'accrual'])
          .optional()
          .describe(
            'cash (default): every movement counts on the day the money moved, which is what the bank statement says. accrual: a movement attached to another month counts in that month, which is what makes a month comparable to the next when a salary lands late or a rent is paid ahead. Use accrual to answer "how was August really", cash to answer "what left the accounts in August"',
          ),
      }),
    },
    async ({ from, to, groupBy, reading = 'cash' }) =>
      run(async () => {
        const line = (r: BreakdownRow, dimension: string) => ({
          [dimension]: r.label ?? '(none)',
          gross: Number(r.gross),
          net: Number(r.net),
          movements: Number(r.count),
        })
        // A group has no entity behind it, so it cannot be drilled into by a
        // filter: it comes with the categories it merges, the way the screen
        // unfolds it. Left to a second call, the totals would have to be added
        // up by whoever asked, which is exactly the arithmetic to avoid.
        const rows =
          groupBy === 'categoryGroup'
            ? (await spendingByCategoryGroup(userId, from, to, 'expense', reading)).map((mass) => ({
                ...line(mass, 'categoryGroup'),
                categories: mass.categories.map((c) => line(c, 'category')),
              }))
            : (await spendingBreakdown(userId, from, to, groupBy, 'expense', reading)).map((r) =>
                line(r, groupBy),
              )
        // The reading is part of the answer, not part of the question: two
        // totals exist for one month, and a table without its label is unusable.
        return ok({
          reading,
          window:
            reading === 'accrual'
              ? `movements attached to ${from.slice(0, 7)} → ${to.slice(0, 7)} (whole months)`
              : `movements settled between ${from} and ${to}`,
          rows,
        })
      }),
  )
}
