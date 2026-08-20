import { DomainError } from '@abacus/core/domain/errors'
import { closeAccount, createAccount, listAccounts } from '@abacus/core/services/accounts'
import { addAlias, createActor, listActors, mergeActors } from '@abacus/core/services/actors'
import { createAdjustment, latestCheck, recordBalanceCheck } from '@abacus/core/services/balanceChecks'
import { createActivity, createCategory, listActivities, listCategories } from '@abacus/core/services/catalog'
import {
  cancelCommitment,
  changeAmount,
  confirmNextOccurrence,
  createFinancing,
  createSubscription,
  listCommitmentsWithProgress,
  monthlyEquivalent,
  pendingOccurrences,
  setJudgment,
  skipNextOccurrence,
} from '@abacus/core/services/commitments'
import {
  closeAdvance,
  correctMovement,
  declareMovement,
  deleteMovement,
  listMovements,
  outstandingAdvances,
} from '@abacus/core/services/movements'
import { spendingBreakdown } from '@abacus/core/services/reports'
import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import {
  requireAccountByName,
  requireActivityByName,
  requireActorByName,
  requireCategoryByName,
  requireCommitment,
} from './resolve.ts'

/**
 * This file IS the interface. The AI using these tools never sees this
 * repository: tool names, descriptions and error messages are its entire
 * world. Work on them like UI copy, and treat every misuse observed in real
 * sessions as an interface defect to fix here.
 */

const INSTRUCTIONS = `abacus manages the user's personal finances, fully declaratively (no bank connection: the user tells you what happened, you record it).
Model: every movement goes from a source to a target; between two owned accounts it is an internal transfer (neutral, never an expense), to an external actor an expense, from an actor an income. Actors (merchants, clients, organizations) are normalized through aliases: never create a duplicate without checking the suggestions first. Amounts are always positive, in euros. Balance checks (record_balance_check) are the safety net of declarative bookkeeping: suggest one when the latest is older than two weeks. Start with get_overview when you take over without context.`

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

function ok(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 1) }] }
}

function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** Actionable guidance for domain errors raised below the MCP layer. */
const GUIDANCE: Record<string, string> = {
  account_closed: 'This account is closed at that date. Check the movement date or the targeted account.',
  transfer_has_no_category:
    'An internal transfer never carries a category: drop it, categories only apply to expenses and incomes.',
  not_an_advance:
    'The referenced movement is not marked as an advance, so a refund cannot be linked to it. Check the id with list_outstanding_advances.',
  financing_settled: 'Every installment of this financing is already paid: it is settled.',
  cancelled: 'This commitment is cancelled: there is no occurrence left to confirm.',
  already_cancelled: 'This commitment is already cancelled.',
  no_gap: 'This balance check has no gap: nothing to settle.',
  actor_exists:
    'This name or alias already resolves to an existing actor: reuse it instead of creating a duplicate.',
  alias_taken: 'This alias already resolves to an actor: pick another one or merge the actors.',
  merge_self: 'An actor cannot be merged into itself.',
  not_a_subscription: 'Only subscriptions carry a judgment (essential / reducible / to_cancel).',
  movement_not_found:
    'No such movement for this user. Get a current id from list_movements: an id from an earlier answer may already be gone.',
  refunded_movement:
    'Another movement refunds this one, so deleting it would leave that refund pointing at nothing. Delete the refund first, or correct this movement instead.',
  financing_needs_amount: 'A financing needs its total amount (totalAmount) over N installments.',
  bad_source: 'A movement needs exactly one source: an owned account or an external actor, never both.',
  bad_target: 'A movement needs exactly one target: an owned account or an external actor, never both.',
  no_owned_account:
    "A movement must touch at least one of the user's own accounts. Actor-to-actor is not something this app records.",
}

function toFailure(e: unknown): ToolResult {
  if (e instanceof DomainError) return fail(GUIDANCE[e.code] ?? e.message)
  throw e
}

async function run(handler: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await handler()
  } catch (e) {
    return toFailure(e)
  }
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('Date in YYYY-MM-DD format')

export function buildServer(userId: string): McpServer {
  const server = new McpServer({ name: 'abacus', version: '0.1.0' }, { instructions: INSTRUCTIONS })

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
        const advances = await outstandingAdvances(userId)
        const commitments = (await listCommitmentsWithProgress(userId)).filter((c) => !c.cancelledOn)
        const monthlyOut = commitments
          .filter((c) => c.direction === 'outgoing')
          .reduce((sum, c) => sum + monthlyEquivalent(c), 0)
        return ok({
          accounts: accountsView,
          pendingOccurrences: pending.map((p) => ({
            commitment: p.commitment.label,
            dueOn: p.dueOn,
            amount: Number(p.commitment.amount),
            direction: p.commitment.direction,
          })),
          outstandingAdvances: advances.map((a) => ({
            movementId: a.id,
            happenedOn: a.happenedOn,
            advanced: Number(a.amount),
            refunded: Number(a.refunded),
            remaining: Math.round((Number(a.amount) - Number(a.refunded)) * 100) / 100,
          })),
          monthlyCommittedCost: Math.round(monthlyOut * 100) / 100,
        })
      }),
  )

  server.registerTool(
    'declare_movements',
    {
      description:
        'Records a batch of movements the user declares: expenses, incomes, internal transfers. This is the daily entry tool. Everything is addressed by NAME (accounts, actors, categories), never by id. An unknown actor fails its own line with suggestions: reuse a close existing actor instead of creating a duplicate ("McDo" and "McDonald\'s" are the same actor), and only pass createUnknownActors: true for genuinely new actors. Amounts are always positive; the direction comes from the type. Do not use it for subscription debits (confirm_due_movements) nor to settle a balance-check gap (settle_check_gap). Each line succeeds or fails independently: read the result line by line.',
      inputSchema: z.object({
        movements: z
          .array(
            z.object({
              date: isoDate,
              amount: z
                .number()
                .positive()
                .describe('Amount, always positive; the direction comes from the type'),
              type: z
                .enum(['expense', 'income', 'transfer'])
                .describe(
                  'expense: account → actor; income: actor → account; transfer: account → account (neutral, never an expense)',
                ),
              account: z
                .string()
                .describe('Account name: the one paying (expense, transfer) or receiving (income)'),
              toAccount: z.string().optional().describe('transfer only: the receiving account'),
              actor: z
                .string()
                .optional()
                .describe(
                  'expense/income: the external counterparty (merchant, client, organization). Forbidden on a transfer',
                ),
              category: z
                .string()
                .optional()
                .describe('Exact name of an existing category. Never on a transfer'),
              activity: z
                .string()
                .nullable()
                .optional()
                .describe(
                  'Sphere (e.g. Freelance). Omitted: inherited from the actor. null: force "none" (personal)',
                ),
              note: z.string().optional(),
              expectedRefundFrom: z
                .string()
                .optional()
                .describe(
                  "Expense advanced on someone's behalf: name of the actor who owes the refund. The claim becomes tracked",
                ),
              refundsMovementId: z
                .string()
                .optional()
                .describe(
                  'Income refunding an advance: id of the advanced movement, from list_outstanding_advances',
                ),
            }),
          )
          .min(1),
        createUnknownActors: z
          .boolean()
          .optional()
          .describe(
            'Create unknown actors automatically instead of failing with suggestions. Reserve it for genuinely new actors',
          ),
      }),
    },
    async ({ movements, createUnknownActors }) => {
      const results: unknown[] = []
      for (const [index, m] of movements.entries()) {
        try {
          const account = await requireAccountByName(userId, m.account)
          let sourceAccountId: string | undefined
          let targetAccountId: string | undefined
          let sourceActorId: string | undefined
          let targetActorId: string | undefined
          let createdActor: string | undefined
          if (m.type === 'transfer') {
            if (!m.toAccount)
              throw new DomainError('bad_target', 'A transfer requires toAccount (the receiving account).')
            if (m.actor)
              throw new DomainError('bad_target', 'A transfer goes through no actor: drop the actor field.')
            sourceAccountId = account.id
            targetAccountId = (await requireAccountByName(userId, m.toAccount)).id
          } else {
            if (!m.actor)
              throw new DomainError('bad_target', `A ${m.type} requires actor (the external counterparty).`)
            const { actor, created } = await requireActorByName(userId, m.actor, {
              createIfUnknown: createUnknownActors,
            })
            if (created) createdActor = actor.name
            if (m.type === 'expense') {
              sourceAccountId = account.id
              targetActorId = actor.id
            } else {
              sourceActorId = actor.id
              targetAccountId = account.id
            }
          }
          const categoryId = m.category ? (await requireCategoryByName(userId, m.category)).id : undefined
          const activityId =
            m.activity === undefined
              ? undefined
              : m.activity === null
                ? null
                : (await requireActivityByName(userId, m.activity)).id
          const expectedRefundFromActorId = m.expectedRefundFrom
            ? (
                await requireActorByName(userId, m.expectedRefundFrom, {
                  createIfUnknown: createUnknownActors,
                })
              ).actor.id
            : undefined
          const movement = await declareMovement(userId, {
            happenedOn: m.date,
            amount: m.amount,
            sourceAccountId,
            sourceActorId,
            targetAccountId,
            targetActorId,
            categoryId,
            activityId,
            note: m.note,
            expectedRefundFromActorId,
            refundsMovementId: m.refundsMovementId,
          })
          results.push({
            index,
            ok: true,
            movementId: movement.id,
            kind: movement.kind,
            ...(createdActor ? { createdActor } : {}),
          })
        } catch (e) {
          if (e instanceof DomainError)
            results.push({ index, ok: false, error: GUIDANCE[e.code] ?? e.message })
          else throw e
        }
      }
      const failed = results.filter((r) => !(r as { ok: boolean }).ok).length
      return ok({ results, declared: results.length - failed, failed })
    },
  )

  server.registerTool(
    'list_movements',
    {
      description:
        'Browses the movement history, filterable by period, type, account, actor, category or activity (all by name). Use it to check what is already declared before an entry, find a specific movement, or answer "how much did I spend at X". For grouped totals, prefer analyze_spending.',
      inputSchema: z.object({
        from: isoDate.optional(),
        to: isoDate.optional(),
        kind: z.enum(['expense', 'income', 'transfer']).optional(),
        account: z.string().optional().describe('Account name'),
        actor: z.string().optional().describe('Actor name'),
        category: z.string().optional(),
        activity: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional().describe('Default 100'),
      }),
    },
    async (f) =>
      run(async () => {
        const movements = await listMovements(userId, {
          from: f.from,
          to: f.to,
          kind: f.kind,
          accountId: f.account ? (await requireAccountByName(userId, f.account)).id : undefined,
          actorId: f.actor ? (await requireActorByName(userId, f.actor)).actor.id : undefined,
          categoryId: f.category ? (await requireCategoryByName(userId, f.category)).id : undefined,
          activityId: f.activity ? (await requireActivityByName(userId, f.activity)).id : undefined,
          limit: f.limit,
        })
        return ok(
          movements.map((m) => ({
            id: m.id,
            date: m.happenedOn,
            kind: m.kind,
            amount: Number(m.amount),
            note: m.note ?? undefined,
          })),
        )
      }),
  )

  server.registerTool(
    'record_balance_check',
    {
      description:
        'Checks an account against reality: the user reads the actual balance in their banking app, you declare it here. The tool compares it with the balance computed from declared movements and returns the gap. Zero gap: the books are right. Non-zero gap: movements are missing; the right answer is to declare them (declare_movements) and check again, and only as a last resort settle the gap in bulk with settle_check_gap. This is the safety net of declarative bookkeeping: offer it regularly.',
      inputSchema: z.object({
        account: z.string().describe('Name of the checked account'),
        balance: z.number().describe('Actual balance read in the banking app (may be negative)'),
        date: isoDate.optional().describe('Defaults to today'),
        note: z.string().optional(),
      }),
    },
    async ({ account, balance, date, note }) =>
      run(async () => {
        const acc = await requireAccountByName(userId, account)
        const result = await recordBalanceCheck(userId, acc.id, balance, date, note)
        const guidance =
          result.gap === 0
            ? 'No gap: the declared movements match reality.'
            : result.gap < 0
              ? `${Math.abs(result.gap)} € of outflows are missing. Ask the user what was forgotten, declare it, then check again; otherwise settle in bulk with settle_check_gap (checkId below).`
              : `${result.gap} € of inflows are missing. Same approach: declare what is missing, or settle with settle_check_gap.`
        return ok({
          checkId: result.check.id,
          declared: Number(result.check.declaredBalance),
          computed: Number(result.check.computedBalance),
          gap: result.gap,
          guidance,
        })
      }),
  )

  server.registerTool(
    'settle_check_gap',
    {
      description:
        'Settles a balance-check gap with an explicit adjustment movement, dated at the check, attributed to an actor of the user\'s choice (e.g. an "Unknown" actor) and categorizable. Last resort when the user cannot reconstruct the detail: always prefer declaring the real movements. Refuses a check without a gap.',
      inputSchema: z.object({
        checkId: z.string().describe('Balance check id, returned by record_balance_check'),
        actor: z.string().describe('Attribution actor (e.g. "Unknown"). Must already exist'),
        category: z.string().optional(),
        note: z.string().optional(),
      }),
    },
    async ({ checkId, actor, category, note }) =>
      run(async () => {
        const actorRow = (await requireActorByName(userId, actor)).actor
        const movement = await createAdjustment(userId, checkId, {
          actorId: actorRow.id,
          categoryId: category ? (await requireCategoryByName(userId, category)).id : undefined,
          note,
        })
        return ok({ movementId: movement.id, kind: movement.kind, amount: Number(movement.amount) })
      }),
  )

  server.registerTool(
    'manage_subscription',
    {
      description:
        'Manages subscriptions and recurring incomes (open-ended commitments). Actions: create (new subscription, or a salary with direction incoming), change_price (the price changed: the dated history is kept, which is how raises become visible), set_judgment (essential / reducible / to_cancel, with a note), cancel (no more occurrences). For an installment purchase use declare_financing. The actual debit of each occurrence is confirmed through confirm_due_movements, never through declare_movements.',
      inputSchema: z.object({
        action: z.enum(['create', 'change_price', 'set_judgment', 'cancel']),
        commitment: z
          .string()
          .optional()
          .describe('Every action except create: label (or id) of the commitment'),
        label: z.string().optional().describe('create: subscription name (e.g. "Netflix")'),
        actor: z.string().optional().describe('create: the actor debiting (or paying, if incoming)'),
        account: z.string().optional().describe('create: the debited (or credited) account'),
        amount: z
          .number()
          .positive()
          .optional()
          .describe('create: amount per period; change_price: the new amount'),
        periodUnit: z.enum(['week', 'month', 'year']).optional().describe('create: defaults to month'),
        periodCount: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('create: every N periods, defaults to 1'),
        firstDueOn: isoDate.optional().describe('create: next expected occurrence'),
        direction: z
          .enum(['outgoing', 'incoming'])
          .optional()
          .describe('create: incoming for a recurring income (salary), defaults to outgoing'),
        category: z.string().optional().describe('create: category of the generated movements'),
        activity: z
          .string()
          .optional()
          .describe('create: sphere of the generated movements (e.g. Freelance)'),
        judgment: z.enum(['essential', 'reducible', 'to_cancel']).optional().describe('create/set_judgment'),
        judgmentNote: z.string().optional(),
        engagedUntil: isoDate.optional().describe('create: end of the contractual lock-in period, if any'),
        effectiveOn: isoDate.optional().describe('change_price/cancel: effective date, defaults to today'),
      }),
    },
    async (a) =>
      run(async () => {
        if (a.action === 'create') {
          if (!a.label || !a.actor || !a.account || !a.amount || !a.firstDueOn)
            return fail('create requires label, actor, account, amount and firstDueOn.')
          const commitment = await createSubscription(userId, {
            label: a.label,
            actorId: (await requireActorByName(userId, a.actor, { createIfUnknown: true })).actor.id,
            accountId: (await requireAccountByName(userId, a.account)).id,
            direction: a.direction,
            amount: a.amount,
            periodUnit: a.periodUnit ?? 'month',
            periodCount: a.periodCount,
            firstDueOn: a.firstDueOn,
            categoryId: a.category ? (await requireCategoryByName(userId, a.category)).id : undefined,
            activityId: a.activity ? (await requireActivityByName(userId, a.activity)).id : undefined,
            judgment: a.judgment,
            judgmentNote: a.judgmentNote,
            engagedUntil: a.engagedUntil,
          })
          return ok({ commitmentId: commitment.id, label: commitment.label, nextDueOn: commitment.nextDueOn })
        }
        if (!a.commitment) return fail(`${a.action} requires commitment (label or id).`)
        const target = await requireCommitment(userId, a.commitment)
        if (a.action === 'change_price') {
          if (!a.amount) return fail('change_price requires amount (the new price).')
          const updated = await changeAmount(userId, target.id, a.amount, a.effectiveOn)
          return ok({
            commitmentId: updated.id,
            amount: Number(updated.amount),
            note: 'Change recorded in the dated history.',
          })
        }
        if (a.action === 'set_judgment') {
          if (!a.judgment) return fail('set_judgment requires judgment.')
          const updated = await setJudgment(userId, target.id, a.judgment, a.judgmentNote)
          return ok({
            commitmentId: updated.id,
            judgment: updated.judgment,
            judgmentNote: updated.judgmentNote,
          })
        }
        const cancelled = await cancelCommitment(userId, target.id, a.effectiveOn)
        return ok({ commitmentId: cancelled.id, cancelledOn: cancelled.cancelledOn })
      }),
  )

  server.registerTool(
    'declare_financing',
    {
      description:
        'Declares an installment purchase (financing): a total amount paid in N installments. Give the total and the number of installments — the per-installment amount is derived by division. The remaining due is derived from confirmed installments (see list_commitments) and the financing settles itself at the last one. Installments are then confirmed through confirm_due_movements.',
      inputSchema: z.object({
        label: z.string().describe('What is being financed (e.g. "Sofa x4")'),
        actor: z.string().describe('The creditor (store, payment provider)'),
        account: z.string().describe('Account debited at each installment'),
        totalAmount: z.number().positive().describe('Total owed across every installment'),
        installmentsTotal: z.number().int().min(2).describe('Total number of installments'),
        firstDueOn: isoDate.describe('First installment date'),
        installmentAmount: z
          .number()
          .positive()
          .optional()
          .describe(
            'Only when the installments are not simply the total divided by their count (uneven split, fees)',
          ),
        periodUnit: z
          .enum(['week', 'month', 'year'])
          .optional()
          .describe('Defaults to month; week with periodCount 2 for a pay-in-4 every two weeks'),
        periodCount: z.number().int().positive().optional(),
        category: z.string().optional(),
      }),
    },
    async (f) =>
      run(async () => {
        const commitment = await createFinancing(userId, {
          label: f.label,
          actorId: (await requireActorByName(userId, f.actor, { createIfUnknown: true })).actor.id,
          accountId: (await requireAccountByName(userId, f.account)).id,
          installmentAmount: f.installmentAmount,
          installmentsTotal: f.installmentsTotal,
          totalAmount: f.totalAmount,
          periodUnit: f.periodUnit,
          periodCount: f.periodCount,
          firstDueOn: f.firstDueOn,
          categoryId: f.category ? (await requireCategoryByName(userId, f.category)).id : undefined,
        })
        return ok({
          commitmentId: commitment.id,
          label: commitment.label,
          totalAmount: Number(commitment.totalAmount),
          installmentsTotal: commitment.installmentsTotal,
          installmentAmount: Number(commitment.amount),
          nextDueOn: commitment.nextDueOn,
        })
      }),
  )

  server.registerTool(
    'list_commitments',
    {
      description:
        'The commitments review: subscriptions with monthly-equivalent cost and judgment (essential / reducible / to_cancel), financings with paid installments and remaining due. This is the tool for "what could I cut?" and for tracking installment purchases. Includes cancelled ones only with includeCancelled.',
      inputSchema: z.object({
        includeCancelled: z.boolean().optional(),
      }),
    },
    async ({ includeCancelled }) =>
      run(async () => {
        const commitments = await listCommitmentsWithProgress(userId, !includeCancelled)
        const view = commitments.map((c) => {
          if (c.kind === 'financing' && c.progress) {
            return {
              type: 'financing',
              label: c.label,
              id: c.id,
              installment: Number(c.amount),
              paidInstallments: `${c.progress.paidInstallments}/${c.installmentsTotal}`,
              remainingDue: c.progress.remainingDue,
              nextDueOn: c.progress.paidInstallments >= (c.installmentsTotal ?? 0) ? 'settled' : c.nextDueOn,
            }
          }
          return {
            type: 'subscription',
            label: c.label,
            id: c.id,
            direction: c.direction,
            amount: Number(c.amount),
            every: `${c.periodCount} ${c.periodUnit}`,
            monthlyEquivalent: monthlyEquivalent(c),
            judgment: c.judgment ?? 'not judged',
            judgmentNote: c.judgmentNote ?? undefined,
            engagedUntil: c.engagedUntil ?? undefined,
            cancelledOn: c.cancelledOn ?? undefined,
            nextDueOn: c.nextDueOn,
          }
        })
        return ok(view)
      }),
  )

  server.registerTool(
    'confirm_due_movements',
    {
      description:
        'Processes commitment occurrences that reached their date (listed by get_overview): confirm turns the expected occurrence into a real movement and advances the commitment by one period; skip advances without creating a movement (free month, paused service). When reality differed, pass the real amount — recording the truth always wins over the expectation, and that divergence is how silent price bumps get noticed. Then say which kind of divergence it was with amountIsTheNewNorm: a salary that moved for one month (short month, bonus) is a one-off, a raise or a price increase is permanent and must be recorded as such. If the user has not said which, ask before confirming. Always prefer this tool over declare_movements for a subscription debit, otherwise the occurrence stays pending.',
      inputSchema: z.object({
        items: z
          .array(
            z.object({
              commitment: z.string().describe('Label (or id) of the commitment'),
              action: z.enum(['confirm', 'skip']),
              amount: z
                .number()
                .positive()
                .optional()
                .describe('confirm: the real amount when it differs from the expected one'),
              amountIsTheNewNorm: z
                .boolean()
                .optional()
                .describe(
                  'confirm + amount: true when that amount replaces the expected one from now on (a raise, a price increase). It updates the commitment and records a dated price change, so the history shows when it moved. Leave it out or false for a one-off month, which changes nothing for the next occurrences.',
                ),
              date: isoDate.optional().describe('confirm: the real date when it differs from the due date'),
            }),
          )
          .min(1),
      }),
    },
    async ({ items }) => {
      const results: unknown[] = []
      for (const item of items) {
        try {
          const commitment = await requireCommitment(userId, item.commitment)
          if (item.action === 'skip') {
            const updated = await skipNextOccurrence(userId, commitment.id)
            results.push({ commitment: commitment.label, skipped: true, nextDueOn: updated.nextDueOn })
          } else {
            const expected = Number(commitment.amount)
            const movement = await confirmNextOccurrence(userId, commitment.id, {
              amount: item.amount,
              happenedOn: item.date,
              updateReference: item.amountIsTheNewNorm,
            })
            const diverged = item.amount !== undefined && item.amount !== expected
            results.push({
              commitment: commitment.label,
              movementId: movement.id,
              amount: Number(movement.amount),
              ...(diverged
                ? {
                    expected,
                    reference: item.amountIsTheNewNorm
                      ? `Updated to ${item.amount} € and recorded as a dated price change.`
                      : `Left at ${expected} €, treated as a one-off. Pass amountIsTheNewNorm if it is permanent.`,
                  }
                : {}),
            })
          }
        } catch (e) {
          if (e instanceof DomainError)
            results.push({ commitment: item.commitment, ok: false, error: GUIDANCE[e.code] ?? e.message })
          else throw e
        }
      }
      return ok({ results })
    },
  )

  server.registerTool(
    'analyze_spending',
    {
      description:
        'Breaks spending down over a period by category, actor or activity. Always returns two readings: gross (what actually left the accounts) and net (gross minus linked refunds actually received). Internal transfers never appear here. For freelance revenue, group by activity and look at incomes through list_movements (kind: income).',
      inputSchema: z.object({
        from: isoDate,
        to: isoDate,
        groupBy: z.enum(['category', 'actor', 'activity']),
      }),
    },
    async ({ from, to, groupBy }) =>
      run(async () => {
        const rows = await spendingBreakdown(userId, from, to, groupBy)
        return ok(
          rows.map((r) => ({
            [groupBy]: r.label ?? '(none)',
            gross: Number(r.gross),
            net: Number(r.net),
          })),
        )
      }),
  )

  server.registerTool(
    'list_outstanding_advances',
    {
      description:
        'Open claims: expenses advanced on someone\'s behalf, awaiting a refund (full or partial). Gives the movementId to pass in declare_movements (refundsMovementId field) when a refund arrives. An abandoned claim ("they will never pay the rest") is closed with close_advance: it leaves this list, the expense stays whole.',
      inputSchema: z.object({}),
    },
    async () =>
      run(async () => {
        const advances = await outstandingAdvances(userId)
        return ok(
          advances.map((a) => ({
            movementId: a.id,
            date: a.happenedOn,
            advanced: Number(a.amount),
            refunded: Number(a.refunded),
            remaining: Math.round((Number(a.amount) - Number(a.refunded)) * 100) / 100,
            note: a.note ?? undefined,
          })),
        )
      }),
  )

  server.registerTool(
    'close_advance',
    {
      description:
        "Writes off the remainder of a claim: the person will not refund (any more of) it. The expense stays fully counted in both gross and net; only the claim tracking stops. Practically irreversible: confirm the user's intent before calling.",
      inputSchema: z.object({
        movementId: z.string().describe('Id of the advanced expense, from list_outstanding_advances'),
      }),
    },
    async ({ movementId }) =>
      run(async () => {
        const movement = await closeAdvance(userId, movementId)
        return ok({ movementId: movement.id, closed: true })
      }),
  )

  server.registerTool(
    'manage_accounts',
    {
      description:
        "Manages the user's accounts. Actions: list (with balances), create (behavior: payment = current account carrying daily spending, savings = savings book, investment = brokerage/crypto), close (the account keeps its history, it just stops accepting later movements). Accounts mirror the user's real banking setup: never create one without an explicit request.",
      inputSchema: z.object({
        action: z.enum(['list', 'create', 'close']),
        name: z.string().optional().describe('create/close: account name (e.g. "Fortuneo checking")'),
        behavior: z.enum(['payment', 'savings', 'investment']).optional().describe('create'),
        institution: z.string().optional().describe('create: institution, free text'),
        openedOn: isoDate.optional(),
        closedOn: isoDate.optional().describe('close: defaults to today'),
      }),
    },
    async (a) =>
      run(async () => {
        if (a.action === 'list') {
          const accounts = await listAccounts(userId)
          return ok(
            accounts.map((acc) => ({
              name: acc.name,
              behavior: acc.behavior,
              institution: acc.institution ?? undefined,
              balance: Number(acc.balance),
              closedOn: acc.closedOn ?? undefined,
            })),
          )
        }
        if (!a.name) return fail(`${a.action} requires name.`)
        if (a.action === 'create') {
          if (!a.behavior) return fail('create requires behavior (payment, savings or investment).')
          const account = await createAccount({
            userId,
            name: a.name,
            behavior: a.behavior,
            institution: a.institution ?? null,
            openedOn: a.openedOn ?? null,
          })
          return ok({ accountId: account.id, name: account.name })
        }
        const account = await requireAccountByName(userId, a.name)
        const closed = await closeAccount(userId, account.id, a.closedOn)
        return ok({ accountId: closed.id, closedOn: closed.closedOn })
      }),
  )

  server.registerTool(
    'manage_actors',
    {
      description:
        'Manages the actor referential (counterparties: merchants, clients, organizations, people). Actions: list, create (with aliases and an optional activity: an actor attached to an activity, e.g. a client attached to Freelance, passes that sphere to its movements), add_alias ("Macdo" must resolve to McDonald\'s), merge (absorb a duplicate: all history moves to keep, the absorbed name becomes an alias). The cleanliness of this referential drives every analysis: merge duplicates as soon as they appear.',
      inputSchema: z.object({
        action: z.enum(['list', 'create', 'add_alias', 'merge']),
        name: z.string().optional().describe('create: canonical name'),
        aliases: z.array(z.string()).optional().describe('create: initial aliases'),
        activity: z.string().optional().describe("create: activity passed on to this actor's movements"),
        note: z.string().optional(),
        actor: z.string().optional().describe('add_alias: target actor'),
        alias: z.string().optional().describe('add_alias: the new alias'),
        keep: z.string().optional().describe('merge: the actor to keep'),
        absorb: z
          .string()
          .optional()
          .describe('merge: the duplicate to absorb (its name becomes an alias of keep)'),
      }),
    },
    async (a) =>
      run(async () => {
        if (a.action === 'list') {
          const [actors, activities] = await Promise.all([listActors(userId), listActivities(userId)])
          const activityName = new Map(activities.map((act) => [act.id, act.name]))
          return ok(
            actors.map((actor) => ({
              name: actor.name,
              activity: actor.activityId ? activityName.get(actor.activityId) : undefined,
              note: actor.note ?? undefined,
            })),
          )
        }
        if (a.action === 'create') {
          if (!a.name) return fail('create requires name.')
          const actor = await createActor(userId, {
            name: a.name,
            aliases: a.aliases,
            activityId: a.activity ? (await requireActivityByName(userId, a.activity)).id : undefined,
            note: a.note,
          })
          return ok({ actorId: actor.id, name: actor.name })
        }
        if (a.action === 'add_alias') {
          if (!a.actor || !a.alias) return fail('add_alias requires actor and alias.')
          const target = (await requireActorByName(userId, a.actor)).actor
          await addAlias(userId, target.id, a.alias)
          return ok({ actor: target.name, alias: a.alias })
        }
        if (!a.keep || !a.absorb) return fail('merge requires keep and absorb.')
        const keep = (await requireActorByName(userId, a.keep)).actor
        const absorb = (await requireActorByName(userId, a.absorb)).actor
        const merged = await mergeActors(userId, keep.id, absorb.id)
        return ok({
          kept: merged.name,
          absorbed: absorb.name,
          note: `"${absorb.name}" is now an alias of "${merged.name}".`,
        })
      }),
  )

  server.registerTool(
    'manage_categories',
    {
      description:
        "Manages expense and income categories (the user's vocabulary, flat, with an optional group). Actions: list, create. Never invent a category close to an existing one: list first, and ask the user when in doubt. Internal transfers never have a category.",
      inputSchema: z.object({
        action: z.enum(['list', 'create']),
        name: z.string().optional().describe('create'),
        group: z.string().optional().describe('create: optional group (e.g. "Everyday life")'),
      }),
    },
    async (a) =>
      run(async () => {
        if (a.action === 'list') {
          const categories = await listCategories(userId)
          return ok(categories.map((c) => ({ name: c.name, group: c.groupLabel ?? undefined })))
        }
        if (!a.name) return fail('create requires name.')
        const category = await createCategory(userId, a.name, a.group)
        return ok({ categoryId: category.id, name: category.name })
      }),
  )

  server.registerTool(
    'fix_movement',
    {
      description:
        'Repairs an already declared movement: correct what was mistyped, or delete what should never have been recorded (a duplicate, an entry that turned out not to have happened). Get the id from list_movements first — this tool never guesses which movement is meant. Correcting rebuilds the movement from what you pass: give the type and every field that applies to it, exactly as with declare_movements, because switching an expense to a transfer has to drop its actor and its category. What it never touches: the links to an origin (a confirmed occurrence, a balance-check adjustment) and the advance or refund links. Deleting is not how you undo a confirmed occurrence — the commitment has already moved on and would need manage_subscription. Prefer correcting over delete-then-redeclare: the movement keeps its identity and its links.',
      inputSchema: z.object({
        movement: z.string().describe('Id of the movement, from list_movements'),
        action: z.enum(['correct', 'delete']),
        date: isoDate.optional().describe('correct: the real date'),
        amount: z.number().positive().optional().describe('correct: the real amount, always positive'),
        type: z
          .enum(['expense', 'income', 'transfer'])
          .optional()
          .describe(
            'correct: required when the endpoints change. expense: account → actor; income: actor → account; transfer: account → account',
          ),
        account: z
          .string()
          .optional()
          .describe('correct: the owned account — paying (expense, transfer) or receiving (income)'),
        toAccount: z.string().optional().describe('correct, transfer only: the receiving account'),
        actor: z
          .string()
          .optional()
          .describe('correct, expense/income only: the external counterparty. Must already exist'),
        category: z
          .string()
          .optional()
          .describe(
            'correct: exact name of an existing category, or "none" to clear it. Never on a transfer',
          ),
        activity: z.string().optional().describe('correct: existing activity name, or "none" to clear it'),
        note: z.string().optional().describe('correct: free note, or "none" to clear it'),
      }),
    },
    async (f) =>
      run(async () => {
        if (f.action === 'delete') {
          await deleteMovement(userId, f.movement)
          return ok({ movementId: f.movement, deleted: true })
        }
        const clearable = (value: string | undefined) =>
          value === undefined ? undefined : value.toLowerCase() === 'none' ? null : value
        const endpoints: Record<string, string | null> = {}
        if (f.type) {
          if (!f.account) return fail('correct with a type requires account.')
          const account = (await requireAccountByName(userId, f.account)).id
          if (f.type === 'transfer') {
            if (!f.toAccount) return fail('correct to a transfer requires toAccount.')
            endpoints.sourceAccountId = account
            endpoints.targetAccountId = (await requireAccountByName(userId, f.toAccount)).id
            endpoints.sourceActorId = null
            endpoints.targetActorId = null
          } else {
            if (!f.actor) return fail(`correct to an ${f.type} requires actor.`)
            const actor = (await requireActorByName(userId, f.actor)).actor.id
            const expense = f.type === 'expense'
            endpoints.sourceAccountId = expense ? account : null
            endpoints.targetActorId = expense ? actor : null
            endpoints.sourceActorId = expense ? null : actor
            endpoints.targetAccountId = expense ? null : account
          }
        }
        const category = clearable(f.category)
        const activity = clearable(f.activity)
        const movement = await correctMovement(userId, f.movement, {
          happenedOn: f.date,
          amount: f.amount,
          ...endpoints,
          categoryId: category ? (await requireCategoryByName(userId, category)).id : category,
          activityId: activity ? (await requireActivityByName(userId, activity)).id : activity,
          note: clearable(f.note),
        })
        return ok({
          movementId: movement.id,
          date: movement.happenedOn,
          amount: Number(movement.amount),
          kind: movement.kind,
        })
      }),
  )

  server.registerTool(
    'manage_activities',
    {
      description:
        'Manages activities: the user\'s economic spheres (e.g. "Freelance"). A movement without an activity is personal. An activity attaches to the relevant actors (clients, tax agencies) and passes on to their movements; that is what carries per-activity revenue and charges tracking. Actions: list, create. Create very few: it partitions the finances, it is not a tag system.',
      inputSchema: z.object({
        action: z.enum(['list', 'create']),
        name: z.string().optional().describe('create'),
      }),
    },
    async (a) =>
      run(async () => {
        if (a.action === 'list') {
          const activities = await listActivities(userId)
          return ok(activities.map((act) => act.name))
        }
        if (!a.name) return fail('create requires name.')
        const activity = await createActivity(userId, a.name)
        return ok({ activityId: activity.id, name: activity.name })
      }),
  )

  return server
}
