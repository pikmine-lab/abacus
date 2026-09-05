import { fiscalYearOf } from '@abacus/core/domain/levy-engine'
import {
  activityLevies,
  activityStatement,
  confirmLevyPayment,
} from '@abacus/core/services/activityStatement'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { requireAccountByName, requireActivityByName, requireActorByName } from '../resolve.ts'
import { fail, isoDate, ok, run } from './shared.ts'

/**
 * The activity statement, for an AI that never sees a screen: everything one
 * fiscal year owes, has paid and may pay out, in one call, with the basis and
 * the state of every figure said in the answer rather than assumed.
 */

export function registerActivityTools(server: McpServer, userId: string): void {
  server.registerTool(
    'get_activity_statement',
    {
      description:
        'The whole picture of one fiscal year of a business activity: revenue, charges, provisions, net, what was paid out to the owner, month by month, then rule by rule, with the schedule of what is due and what may be taken out today. Use it to answer "how is the business doing", "what do I still owe", "how much can I pay myself", or to prepare a return. Three figures answer three different questions and must never be swapped: a provision is what a period owes under a rule; the reserve is what has accrued and is not yet paid, money that has to stay on the account; payableToSelf is a stock (the money the accounts the activity lives on hold, less that reserve, less what every other activity living on those same accounts still owes, less the commitments falling due before the month ends), while net is a flow of the year. Those accounts come with it: each says which other activities live on it, and shared says what each of them is keeping, so a shared account is named rather than left to be discovered in a figure that looks too small. Every figure is an estimate computed from the rules the user declared and the movements recorded, never an official assessment: say so when reporting, and say the status of a rule whose figures you quote (confirmed, extended_by_default when a lapsed text is still being applied, unconfirmed when no text fixes the value), plus reviewDue when a rule is past the day it should have been checked again. Revenue is read in the regime\'s own basis (cash: the day the money arrived; invoiced: the day the invoice was issued) and the other reading travels beside it: name which one you are quoting. A rule with pass_through (VAT collected for the state) stays out of the net and inside the reserve, because it is owed. accrualMethod says how the running period was estimated. Rules themselves are configured elsewhere; this tool only reads them.',
      inputSchema: z.object({
        activity: z.string().describe('The activity, by name (e.g. "Freelance")'),
        year: z
          .number()
          .int()
          .optional()
          .describe(
            'The fiscal year, named by the calendar year it opens in. Absent: the year today falls in. A closed year is read as it stands, a running one as of today',
          ),
      }),
    },
    async ({ activity: name, year }) =>
      run(async () => {
        const activity = await requireActivityByName(userId, name)
        const cal = {
          startMonth: activity.fiscalYearStartMonth,
          startDay: activity.fiscalYearStartDay,
        }
        const today = new Date().toISOString().slice(0, 10)
        const statement = await activityStatement(userId, activity.id, year ?? fiscalYearOf(today, cal))
        return ok({
          activity: {
            name: statement.activity.name,
            regime: statement.activity.regimeLabel ?? undefined,
            fiscalYear: statement.activity.fiscalYear,
            period: statement.activity.period,
            basis:
              statement.basis === 'cash'
                ? 'cash: a receipt counts the day the money arrived'
                : 'invoiced: a receipt counts the day the invoice was issued',
            vatRegistered: statement.activity.vatRegistered,
            startedOn: statement.activity.startedOn ?? undefined,
            closedOn: statement.activity.closedOn ?? undefined,
            monthsOpen: statement.activity.monthsOpen,
          },
          asOf: statement.asOf,
          estimates:
            'every provision, reserve and due amount below is computed from the declared rules: it is an estimate, the assessment makes the truth',
          year: statement.totals,
          months: statement.months,
          levies: statement.levies.map((levy) => ({
            name: levy.name,
            kind: levy.kind,
            status: levy.status,
            reviewDue: levy.reviewDue || undefined,
            source: levy.sourceUrl ?? undefined,
            verifiedOn: levy.verifiedOn ?? undefined,
            period: levy.period,
            settledIn: levy.settlementCategory?.name,
            deductible: levy.deductible,
            passThrough: levy.passThrough || undefined,
            currentPeriod: levy.currentPeriod ?? undefined,
            accrued: levy.accrued,
            accrualMethod:
              levy.accrualMethod === 'prorated'
                ? 'the running period is estimated on its own figures scaled to the whole period, then taken pro rata of the part elapsed'
                : 'closed periods only',
            paid: levy.paid,
            reserve: levy.reserve,
            overpaid: levy.overpaid || undefined,
            assumedElectiveBase: levy.assumedElectiveBase || undefined,
          })),
          schedule: statement.schedule.map((entry) => ({
            levy: entry.levyName,
            what: entry.entry === 'regularization' ? `settlement of ${entry.forFiscalYear}` : 'period',
            period: entry.period,
            declaration: entry.declaration,
            payment: entry.payment,
            amount: entry.amount,
            status: entry.status,
            paidOn: entry.paidOn ?? undefined,
            paidAmount: entry.paidAmount ?? undefined,
            absorbed: entry.absorbed ? 'files no return of its own: it rides in another one' : undefined,
            instalment: entry.instalments > 1 ? `${entry.instalment} of ${entry.instalments}` : undefined,
          })),
          reserve: statement.reserve,
          payableToSelf: statement.payableToSelf,
          revenueByClient: statement.revenueByClient.map((r) => ({
            client: r.label ?? '(none)',
            amount: r.amount,
          })),
          expensesByCategory: statement.expensesByCategory.map((c) => ({
            category: c.label ?? '(none)',
            amount: c.amount,
            settlesLevy: c.settlesLevy || undefined,
          })),
          thresholds: statement.thresholds.map((t) => ({
            label: t.label,
            measure: t.measure,
            over: t.periodRef,
            limit: t.comparison === 'lte' ? `at most ${t.value}` : `at least ${t.value}`,
            current: t.current,
            progress: t.progress,
            breached: t.breached || undefined,
            consequence: t.consequence,
          })),
        })
      }),
  )

  server.registerTool(
    'confirm_levy_payment',
    {
      description:
        "Records that a levy was actually paid: writes the expense from one of the activity's accounts, in the rule's settlement category, which is what makes its reserve fall. Use it when the user says a contribution, a tax or a VAT return was paid, and prefer it over declare_movements, which would file the same money as an ordinary charge and leave the provision standing. Pass the amount that really left, not the estimate: an assessment differing from the estimate is the normal case, and the gap is worth seeing. Get the due dates from get_activity_statement (schedule): each one names the levy, its period and what is estimated.",
      inputSchema: z.object({
        activity: z.string().describe('The activity the rule belongs to, by name'),
        levy: z.string().describe('The rule being settled, by its name as get_activity_statement gives it'),
        periodStart: isoDate.describe(
          "First day of the period being settled, as the schedule gives it (a settlement of a closed year names that year's first day)",
        ),
        amount: z.number().positive().describe('What really left the account, in euros'),
        date: isoDate.describe('The day the money left'),
        account: z.string().describe('The account it left, one of those the activity lives on'),
        actor: z.string().describe('Who was paid: the tax office, the social fund'),
        note: z.string().optional(),
      }),
    },
    async (a) =>
      run(async () => {
        const activity = await requireActivityByName(userId, a.activity)
        const levies = await activityLevies(userId, activity.id)
        const wanted = a.levy.trim().toLowerCase()
        const matches = levies.filter((l) => l.name.toLowerCase() === wanted)
        if (matches.length === 0)
          return fail(
            `No rule named "${a.levy}" on ${activity.name}. Rules: ${levies.map((l) => l.name).join(', ') || 'none'}.`,
          )
        // A rate that changed is a new row with the same name: the one in force
        // on the day of the period settles it.
        const levy =
          matches.find(
            (l) => l.validFrom <= a.periodStart && (l.validTo === null || l.validTo >= a.periodStart),
          ) ?? matches[matches.length - 1]!
        const movement = await confirmLevyPayment(userId, {
          levyId: levy.id,
          periodStart: a.periodStart,
          amount: a.amount,
          date: a.date,
          accountId: (await requireAccountByName(userId, a.account)).id,
          actorId: (await requireActorByName(userId, a.actor, { createIfUnknown: true })).actor.id,
          note: a.note,
        })
        return ok({
          levy: levy.name,
          periodStart: a.periodStart,
          movementId: movement.id,
          amount: Number(movement.amount),
          on: movement.happenedOn,
          note: 'The reserve of this rule falls by that much; get_activity_statement shows where it stands now.',
        })
      }),
  )
}
