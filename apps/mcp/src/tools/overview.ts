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
        'The financial state, ready to reason about: balance per account with the freshness of its latest balance check and what that check still leaves unexplained (openGap: zero once an adjustment has settled the gap, so a non-zero one is always something to act on), commitment occurrences awaiting confirmation, outstanding advances, and the committed monthly recurring cost. Start here when taking over without context, or to answer "where do I stand". Not for detailed history (list_movements) nor period analysis (analyze_flows).',
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
              lastCheck: check ? { on: check.check.checkedOn, openGap: check.openGap } : 'never checked',
            }
          }),
        )
        const pending = await pendingOccurrences(userId)
        const advances = await advancesView(userId)
        const commitments = (await listCommitmentsWithProgress(userId)).filter((c) => !c.cancelledOn)
        // In euros at the latest rate: a USD line added as-is would count
        // dollars as euros. A scheduled placement leaves the account like a
        // subscription does, but it is saving and not cost: added in here it
        // would answer "what do I spend" with money that is still the user's.
        const monthlyOut = commitments
          .filter((c) => c.direction === 'outgoing' && c.kind !== 'investment_plan')
          .reduce((sum, c) => sum + monthlyEquivalentEur(c), 0)
        const monthlyInvested = commitments
          .filter((c) => c.kind === 'investment_plan')
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
            // A placement's occurrence also buys, so it cannot be confirmed
            // without the quantity: saying so here is what stops a confirm
            // attempt that would only come back refused.
            ...(p.placement
              ? {
                  invests: `into ${names.get(p.placement.targetAccountId)}`,
                  needs: 'quantity: the units the broker says the order bought',
                }
              : {}),
          })),
          outstandingAdvances: advances,
          monthlyCommittedCost: Math.round(monthlyOut * 100) / 100,
          // Counted apart, never inside the cost above: what a scheduled
          // placement moves stays the user's money, in another form.
          monthlyScheduledInvestment:
            monthlyInvested > 0 ? Math.round(monthlyInvested * 100) / 100 : undefined,
        })
      }),
  )

  server.registerTool(
    'analyze_flows',
    {
      description:
        'Breaks a period down by category, actor, activity, or the group its categories belong to, on either side of the ledger: spending by default, what came in with kind: income. Rows are ranked biggest first, the order the user sees on screen: keep it when reporting. An expense row carries two readings, gross (what actually left the accounts) and net (gross minus linked refunds actually received), and the ranking follows the net, because the net is what the period actually cost. An income row carries one amount: a refund is an advance coming back, not money earned, so refunds are left out of the income side rather than deducted from it. Every row says how many movements make it. Internal transfers never appear here, and neither do movements declared as ghost: that is exactly what the flag is for, so a total that looks short of a known movement is not a bug. Group by categoryGroup to answer "where does the money go, by big mass" in a handful of rows instead of the full category list: each mass also carries the categories it merges, already totalled and ranked, so drilling into one costs no second call and no addition of your own. Rows with no group (or no category) come back as "(none)". Freelance revenue is kind: income grouped by activity. A period can be read two ways (see reading): always tell the user which one the figures come from, because the same month has two legitimate totals.',
      inputSchema: z.object({
        from: isoDate,
        to: isoDate,
        groupBy: z.enum(['category', 'actor', 'activity', 'categoryGroup']),
        kind: z
          .enum(['expense', 'income'])
          .optional()
          .describe(
            'Which side of the ledger to break down. expense (default): where the money went. income: where it came from. An internal transfer is neither, so it never shows in either',
          ),
        reading: z
          .enum(['cash', 'accrual'])
          .optional()
          .describe(
            'cash (default): every movement counts on the day the money moved, which is what the bank statement says. accrual: a movement attached to another month counts in that month, which is what makes a month comparable to the next when a salary lands late or a rent is paid ahead. Use accrual to answer "how was August really", cash to answer "what left the accounts in August"',
          ),
      }),
    },
    async ({ from, to, groupBy, kind = 'expense', reading = 'cash' }) =>
      run(async () => {
        // An income has one figure where an expense has two: a refund never
        // enters the income side, so a gross and a net there would be the same
        // number written twice, and reading them as a pair would invent a
        // difference.
        const line = (r: BreakdownRow, dimension: string) => ({
          [dimension]: r.label ?? '(none)',
          ...(kind === 'expense'
            ? { gross: Number(r.gross), net: Number(r.net) }
            : { amount: Number(r.gross) }),
          movements: Number(r.count),
        })
        // A group has no entity behind it, so it cannot be drilled into by a
        // filter: it comes with the categories it merges, the way the screen
        // unfolds it. Left to a second call, the totals would have to be added
        // up by whoever asked, which is exactly the arithmetic to avoid.
        const rows =
          groupBy === 'categoryGroup'
            ? (await spendingByCategoryGroup(userId, from, to, kind, reading)).map((mass) => ({
                ...line(mass, 'categoryGroup'),
                categories: mass.categories.map((c) => line(c, 'category')),
              }))
            : (await spendingBreakdown(userId, from, to, groupBy, kind, reading)).map((r) => line(r, groupBy))
        // Both defaults travel back with the figures: the side read is no
        // longer in the tool's name, and one month has two legitimate totals.
        // A table saying neither cannot be read out loud.
        return ok({
          kind,
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
