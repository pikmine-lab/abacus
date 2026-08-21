import { DomainError } from '@abacus/core/domain/errors'
import {
  closeAccount,
  createAccount,
  editAccount,
  listAccounts,
  reopenAccount,
} from '@abacus/core/services/accounts'
import { addAlias, createActor, editActor, listActors, mergeActors } from '@abacus/core/services/actors'
import {
  correctBalanceCheck,
  createAdjustment,
  deleteBalanceCheck,
  latestCheck,
  listChecks,
  recordBalanceCheck,
} from '@abacus/core/services/balanceChecks'
import {
  createActivity,
  createCategory,
  editActivity,
  editCategory,
  listActivities,
  listCategories,
} from '@abacus/core/services/catalog'
import {
  cancelCommitment,
  changeAmount,
  confirmNextOccurrence,
  createFinancing,
  createSubscription,
  editCommitment,
  financingSchedule,
  listCommitmentsWithProgress,
  monthlyEquivalent,
  pendingOccurrences,
  reviseSchedule,
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
  schedule_length_mismatch:
    'The schedule you passed has a different number of installments than installmentsTotal: make them match.',
  schedule_sum_mismatch:
    'The installments do not add up to the total. Fix one or the other: a plan that does not sum to what is owed would make the remaining due wrong.',
  cannot_skip_financing:
    'A financing installment cannot be skipped: it is owed. Confirm it when it is paid, or cancel the financing if the plan ended early.',
  not_a_financing:
    'Only a financing carries a written schedule. A subscription is open-ended: change its amount with manage_subscription.',
  financing_has_no_lock_in:
    'A financing ends at its last installment, so it has no lock-in date. A lock-in period only makes sense on a subscription.',
  schedule_empty:
    'A revision cannot leave a financing without a single installment. To end it early, either revise it down to the installments that remain owed, or cancel it with manage_subscription.',
  installment_not_found:
    'No installment with that id in this financing. Call manage_financing_schedule with action show to get the current ids: they change when a line is dropped.',
  installment_repeated:
    'The same installment id appears twice in the revision. Each line of the plan is one installment: use one entry per installment, and omit the id to add a new one.',
  bad_source: 'A movement needs exactly one source: an owned account or an external actor, never both.',
  bad_target: 'A movement needs exactly one target: an owned account or an external actor, never both.',
  no_owned_account:
    "A movement must touch at least one of the user's own accounts. Actor-to-actor is not something this app records.",
  account_exists:
    'An account already uses that name. Reuse it, or pick another: two accounts cannot share one.',
  account_has_operations:
    'This account holds investment operations, which only an investment account can hold: its behavior cannot change. Everything else about it still corrects.',
  category_exists: 'A category already uses that name. Reuse it instead of creating a variant of it.',
  activity_exists:
    'An activity already uses that name. Reuse it: activities partition the finances, duplicates defeat that.',
  check_not_found:
    'No such balance check for this user. Get a current id from manage_balance_checks with action list.',
  check_already_settled:
    'An adjustment already settles this check. Correct or delete that movement with fix_movement, or correct the check itself with manage_balance_checks.',
}

/** Optional text fields where the AI clears a value by passing "none". */
function clearable(value: string | undefined): string | null | undefined {
  return value === undefined ? undefined : value.toLowerCase() === 'none' ? null : value
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
        'Browses the movement history, filterable by period, type, account, actor, category or activity (all by name). Each line carries its account, its counterparty and its category, so what was declared can be read back and checked. Use it to see what is already there before an entry, to find the id of a movement to repair with fix_movement, or to answer "how much did I spend at X". For grouped totals, prefer analyze_spending.',
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
        const [accounts, actors, categories] = await Promise.all([
          listAccounts(userId),
          listActors(userId),
          listCategories(userId),
        ])
        const accountName = new Map(accounts.map((a) => [a.id, a.name]))
        const actorName = new Map(actors.map((a) => [a.id, a.name]))
        const categoryName = new Map(categories.map((c) => [c.id, c.name]))
        return ok(
          movements.map((m) => ({
            id: m.id,
            date: m.happenedOn,
            kind: m.kind,
            amount: Number(m.amount),
            // The owned account the money moved on; on a transfer, the one it left.
            account: accountName.get((m.sourceAccountId ?? m.targetAccountId)!),
            counterparty:
              m.kind === 'transfer'
                ? accountName.get(m.targetAccountId!)
                : actorName.get((m.sourceActorId ?? m.targetActorId)!),
            category: m.categoryId ? categoryName.get(m.categoryId) : undefined,
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
    'manage_balance_checks',
    {
      description:
        'Reads and repairs the checks already recorded. Actions: list (per account or all, most recent first, with the gap and the adjustment that settled it), correct (the balance was misread, or read on another day), delete (the check should never have been recorded). Correcting is re-checking: the computed side is recalculated from the history as it stands now, for the date given, so the gap says what a check recorded today would say. The adjustment that settled the old gap follows on its own: realigned on the new gap, removed when nothing is left to settle. Deleting a check removes its adjustment too. Recording a fresh check is record_balance_check, settling a gap is settle_check_gap.',
      inputSchema: z.object({
        action: z.enum(['list', 'correct', 'delete']),
        account: z.string().optional().describe('list: restrict to one account, by name'),
        check: z
          .string()
          .optional()
          .describe('correct/delete: id of the check, from list or record_balance_check'),
        balance: z
          .number()
          .optional()
          .describe('correct: the balance as it should have been read (may be negative)'),
        date: isoDate.optional().describe('correct: the day the balance was actually read'),
        note: z.string().optional().describe('correct: free note, or "none" to clear it'),
        limit: z.number().int().min(1).max(200).optional().describe('list: default 50'),
      }),
    },
    async (a) =>
      run(async () => {
        if (a.action === 'list') {
          const accountId = a.account ? (await requireAccountByName(userId, a.account)).id : undefined
          const accounts = await listAccounts(userId)
          const accountName = new Map(accounts.map((acc) => [acc.id, acc.name]))
          const entries = await listChecks(userId, accountId, a.limit)
          return ok(
            entries.map((e) => ({
              checkId: e.check.id,
              account: accountName.get(e.check.accountId),
              on: e.check.checkedOn,
              declared: Number(e.check.declaredBalance),
              computed: Number(e.check.computedBalance),
              gap: e.gap,
              settledByMovement: e.adjustmentId ?? undefined,
              note: e.check.note ?? undefined,
            })),
          )
        }
        if (!a.check) return fail(`${a.action} requires check: the id, from action list.`)
        if (a.action === 'delete') {
          await deleteBalanceCheck(userId, a.check)
          return ok({ checkId: a.check, deleted: true, note: 'Its adjustment, if any, went with it.' })
        }
        const corrected = await correctBalanceCheck(userId, a.check, {
          declaredBalance: a.balance,
          checkedOn: a.date,
          note: clearable(a.note),
        })
        const ADJUSTMENT = {
          realigned: 'The adjustment settling this check was realigned on the new gap.',
          removed: 'Nothing was left to settle: the adjustment was removed.',
          none: 'No adjustment settles this check.',
        }
        return ok({
          checkId: corrected.check.id,
          on: corrected.check.checkedOn,
          declared: Number(corrected.check.declaredBalance),
          computed: Number(corrected.check.computedBalance),
          gap: corrected.gap,
          adjustment: ADJUSTMENT[corrected.adjustment],
        })
      }),
  )

  server.registerTool(
    'manage_subscription',
    {
      description:
        'Manages subscriptions and recurring incomes (open-ended commitments). Actions: create (new subscription, or a salary with direction incoming), change_price (the price changed: the dated history is kept, which is how raises become visible), set_judgment (essential / reducible / to_cancel, with a note), cancel (no more occurrences). For an installment purchase use declare_financing. To correct what the commitment says about itself (label, actor, account, category, periodicity), use update_commitment: a mistyped label is a correction, not a price change. The actual debit of each occurrence is confirmed through confirm_due_movements, never through declare_movements.',
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
    'update_commitment',
    {
      description:
        'Corrects what an existing commitment says about itself: its label, who bills it, the account it hits, how it is filed (category, activity), how often it falls, and a subscription lock-in date. Works on subscriptions, recurring incomes and financings alike, and is the tool for "it is not called that", "it is not debited from that account any more", "wrong category". What it never touches: the movements already recorded, which state what happened on the account it happened on, so the correction applies from the next occurrence onwards. Two things have their own tool: the amount, because a price change is dated history (manage_subscription change_price), and the schedule of a financing (manage_financing_schedule). Turning an outgoing commitment into an incoming one is not a correction: cancel it and declare the right one, because its own past movements would contradict a flipped direction.',
      inputSchema: z.object({
        commitment: z.string().describe('Label (or id) of the commitment to correct'),
        label: z.string().optional().describe('New label'),
        actor: z
          .string()
          .optional()
          .describe('The actor billing (or paying) from now on. Must already exist'),
        account: z.string().optional().describe('The account debited (or credited) from now on'),
        category: z.string().optional().describe('Exact name of an existing category, or "none" to clear it'),
        activity: z.string().optional().describe('Existing activity name, or "none" to clear it'),
        periodUnit: z.enum(['week', 'month', 'year']).optional(),
        periodCount: z.number().int().positive().optional().describe('Every N periods'),
        engagedUntil: z
          .string()
          .optional()
          .describe('Subscription only: end of the contractual lock-in as YYYY-MM-DD, or "none" to clear it'),
      }),
    },
    async (u) =>
      run(async () => {
        const target = await requireCommitment(userId, u.commitment)
        const category = clearable(u.category)
        const activity = clearable(u.activity)
        const updated = await editCommitment(userId, target.id, {
          label: u.label,
          actorId: u.actor ? (await requireActorByName(userId, u.actor)).actor.id : undefined,
          accountId: u.account ? (await requireAccountByName(userId, u.account)).id : undefined,
          categoryId: category ? (await requireCategoryByName(userId, category)).id : category,
          activityId: activity ? (await requireActivityByName(userId, activity)).id : activity,
          periodUnit: u.periodUnit,
          periodCount: u.periodCount,
          engagedUntil: clearable(u.engagedUntil),
        })
        return ok({
          commitmentId: updated.id,
          label: updated.label,
          every: `${updated.periodCount} ${updated.periodUnit}`,
          engagedUntil: updated.engagedUntil ?? undefined,
          note: 'Applies from the next occurrence: the movements already recorded are unchanged.',
        })
      }),
  )

  server.registerTool(
    'declare_financing',
    {
      description:
        'Declares an installment purchase (financing): a total amount paid in N installments. Give the total and the number of installments and the schedule is written for you : equal amounts one period apart, the rounding cent on the last one. Pass installments instead when the real plan is not that: a prorated first month, uneven thirds, a date pushed off a weekend, a payment holiday. That is the normal case for a contract read off a paper, so prefer it whenever the user states actual dates or amounts. Whichever you pass, the installments must add up to the total. The remaining due is then the sum of what is still owed, and each installment is confirmed for its own amount through confirm_due_movements. A plan is not final once written: manage_financing_schedule revises it when reality moves (a date pushed back, an amount renegotiated, an installment added or dropped).',
      inputSchema: z.object({
        label: z.string().describe('What is being financed (e.g. "Sofa x4")'),
        actor: z.string().describe('The creditor (store, payment provider)'),
        account: z.string().describe('Account debited at each installment'),
        totalAmount: z.number().positive().describe('Total owed across every installment'),
        installmentsTotal: z.number().int().min(2).describe('Total number of installments'),
        firstDueOn: isoDate.describe('First installment date'),
        installments: z
          .array(
            z.object({
              dueOn: isoDate.describe('Date this installment is owed'),
              amount: z.number().positive().describe('Amount of this installment alone'),
            }),
          )
          .min(2)
          .optional()
          .describe(
            'The plan spelled out, in contractual order, one entry per installment. Use it as soon as the installments differ from each other or fall on irregular dates. Its length must equal installmentsTotal and its amounts must sum to totalAmount.',
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
          installments: f.installments,
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
          schedule: (await financingSchedule(userId, commitment.id)).map((i) => ({
            position: i.position,
            dueOn: i.dueOn,
            amount: Number(i.amount),
          })),
        })
      }),
  )

  server.registerTool(
    'manage_financing_schedule',
    {
      description:
        'Reads and revises the written plan of a financing. show lists every installment with its id, its date, its amount and whether it is already paid. revise replaces that plan with the one you pass: this is how a pushed-back date, a renegotiated amount, an extra installment or an early settlement gets recorded, and the remaining due follows. Always show before revise, because a revision is the whole plan, not a patch: keep the id of every installment you keep, omit the id to add one, and leave a line out to drop it (dropping a paid one deletes the movement that paid it, so only do that when the installment never was owed). The total owed becomes the sum of the plan, so a renegotiation is expressible instead of blocked. Fixing what was really debited on a paid installment can also be done through fix_movement: both sides stay in sync either way.',
      inputSchema: z.object({
        action: z.enum(['show', 'revise']),
        commitment: z.string().describe('Label (or id) of the financing'),
        installments: z
          .array(
            z.object({
              id: z
                .string()
                .optional()
                .describe('Id of the installment this line keeps, from show. Omit to add a new one'),
              dueOn: isoDate.describe('Date this installment is owed'),
              amount: z.number().positive().describe('Amount of this installment alone'),
            }),
          )
          .min(1)
          .optional()
          .describe('revise: the complete plan you want, in contractual order'),
      }),
    },
    async ({ action, commitment, installments }) =>
      run(async () => {
        const target = await requireCommitment(userId, commitment)
        if (target.kind !== 'financing')
          return fail(GUIDANCE.not_a_financing ?? 'Only a financing carries a written schedule.')
        if (action === 'revise' && !installments)
          return fail('revise requires installments: the whole plan you want, one entry per installment.')
        const financing =
          action === 'revise' ? await reviseSchedule(userId, target.id, installments!) : target
        return ok({
          commitmentId: financing.id,
          label: financing.label,
          totalAmount: Number(financing.totalAmount),
          nextDueOn: financing.nextDueOn,
          installments: (await financingSchedule(userId, financing.id)).map((i) => ({
            id: i.id,
            position: i.position,
            dueOn: i.dueOn,
            amount: Number(i.amount),
            status: i.movementId ? 'paid' : 'due',
          })),
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
        'Processes commitment occurrences that reached their date (listed by get_overview): confirm turns the expected occurrence into a real movement and advances the commitment by one period; skip advances without creating a movement (free month, paused service). When reality differed, pass the real amount : recording the truth always wins over the expectation, and that divergence is how silent price bumps get noticed. Then say which kind of divergence it was with amountIsTheNewNorm: a salary that moved for one month (short month, bonus) is a one-off, a raise or a price increase is permanent and must be recorded as such. If the user has not said which, ask before confirming. Always prefer this tool over declare_movements for a subscription debit, otherwise the occurrence stays pending.',
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
        "Manages the user's accounts. Actions: list (with balances), create (behavior: payment = current account carrying daily spending, savings = savings book, investment = brokerage/crypto), update (correct the name, the institution or the behavior), close (the account keeps its history, it just stops accepting later movements), reopen (undo a close). Accounts mirror the user's real banking setup: never create one without an explicit request, and correct a wrong one rather than adding a second, since closing and recreating would mean redeclaring its whole history.",
      inputSchema: z.object({
        action: z.enum(['list', 'create', 'update', 'close', 'reopen']),
        name: z
          .string()
          .optional()
          .describe('Every action except list: the account, by name (e.g. "Fortuneo checking")'),
        newName: z.string().optional().describe('update: the corrected name'),
        behavior: z.enum(['payment', 'savings', 'investment']).optional().describe('create/update'),
        institution: z
          .string()
          .optional()
          .describe('create/update: institution, free text, or "none" to clear it'),
        openedOn: isoDate.optional().describe('create'),
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
        if (a.action === 'update') {
          const updated = await editAccount(userId, account.id, {
            name: a.newName,
            institution: clearable(a.institution),
            behavior: a.behavior,
          })
          return ok({
            accountId: updated.id,
            name: updated.name,
            behavior: updated.behavior,
            institution: updated.institution ?? undefined,
          })
        }
        if (a.action === 'reopen') {
          const reopened = await reopenAccount(userId, account.id)
          return ok({ accountId: reopened.id, name: reopened.name, closedOn: null })
        }
        const closed = await closeAccount(userId, account.id, a.closedOn)
        return ok({ accountId: closed.id, closedOn: closed.closedOn })
      }),
  )

  server.registerTool(
    'manage_actors',
    {
      description:
        'Manages the actor referential (counterparties: merchants, clients, organizations, people). Actions: list, create (with aliases and an optional activity: an actor attached to an activity, e.g. a client attached to Freelance, passes that sphere to its movements), update (correct the canonical name, the activity or the note), add_alias ("Macdo" must resolve to McDonald\'s), merge (absorb a duplicate: all history moves to keep, the absorbed name becomes an alias). A corrected name replaces the former one, which stops resolving: that is what fixes a typo. A name that really was in use is kept with add_alias instead. The movements already written keep the activity they were written with. The cleanliness of this referential drives every analysis: merge duplicates as soon as they appear.',
      inputSchema: z.object({
        action: z.enum(['list', 'create', 'update', 'add_alias', 'merge']),
        name: z.string().optional().describe('create: canonical name'),
        newName: z.string().optional().describe('update: the corrected canonical name'),
        aliases: z.array(z.string()).optional().describe('create: initial aliases'),
        activity: z
          .string()
          .optional()
          .describe('create/update: activity passed on to this actor\'s movements, or "none" to detach it'),
        note: z.string().optional().describe('create/update: free note, or "none" to clear it'),
        actor: z.string().optional().describe('update/add_alias: target actor'),
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
        if (a.action === 'update') {
          if (!a.actor) return fail('update requires actor: the actor to correct.')
          const target = (await requireActorByName(userId, a.actor)).actor
          const activity = clearable(a.activity)
          const updated = await editActor(userId, target.id, {
            name: a.newName,
            activityId: activity ? (await requireActivityByName(userId, activity)).id : activity,
            note: clearable(a.note),
          })
          return ok({ actorId: updated.id, name: updated.name })
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
        "Manages expense and income categories (the user's vocabulary, flat, with an optional group). Actions: list, create, update (rename it, or change its group). Renaming propagates on its own: the movements filed under a category point at it, not at its name. Never invent a category close to an existing one: list first, and ask the user when in doubt. Internal transfers never have a category.",
      inputSchema: z.object({
        action: z.enum(['list', 'create', 'update']),
        name: z.string().optional().describe('create: the name; update: the category to correct'),
        newName: z.string().optional().describe('update: the corrected name'),
        group: z
          .string()
          .optional()
          .describe('create/update: optional group (e.g. "Everyday life"), or "none" to clear it'),
      }),
    },
    async (a) =>
      run(async () => {
        if (a.action === 'list') {
          const categories = await listCategories(userId)
          return ok(categories.map((c) => ({ name: c.name, group: c.groupLabel ?? undefined })))
        }
        if (!a.name) return fail(`${a.action} requires name.`)
        if (a.action === 'create') {
          const category = await createCategory(userId, a.name, a.group)
          return ok({ categoryId: category.id, name: category.name })
        }
        const target = await requireCategoryByName(userId, a.name)
        const updated = await editCategory(userId, target.id, {
          name: a.newName,
          groupLabel: clearable(a.group),
        })
        return ok({ categoryId: updated.id, name: updated.name, group: updated.groupLabel ?? undefined })
      }),
  )

  server.registerTool(
    'fix_movement',
    {
      description:
        'Repairs an already declared movement: correct what was mistyped, or delete what should never have been recorded (a duplicate, an entry that turned out not to have happened). Get the id from list_movements first: this tool never guesses which movement is meant. Correcting rebuilds the movement from what you pass: give the type and every field that applies to it, exactly as with declare_movements, because switching an expense to a transfer has to drop its actor and its category. What it never touches: the links to an origin (a confirmed occurrence, a balance-check adjustment) and the advance or refund links. Deleting is not how you undo a confirmed occurrence: the commitment has already moved on and would need manage_subscription. Prefer correcting over delete-then-redeclare: the movement keeps its identity and its links. Correcting the amount or the date of a movement that settled a financing installment realigns that installment too, so the plan keeps saying what was really paid, and when.',
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
          .describe('correct: the owned account : paying (expense, transfer) or receiving (income)'),
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
        'Manages activities: the user\'s economic spheres (e.g. "Freelance"). A movement without an activity is personal. An activity attaches to the relevant actors (clients, tax agencies) and passes on to their movements; that is what carries per-activity revenue and charges tracking. Actions: list, create, update (rename it: what is filed under it stays filed under it). Create very few: it partitions the finances, it is not a tag system.',
      inputSchema: z.object({
        action: z.enum(['list', 'create', 'update']),
        name: z.string().optional().describe('create: the name; update: the activity to rename'),
        newName: z.string().optional().describe('update: the corrected name'),
      }),
    },
    async (a) =>
      run(async () => {
        if (a.action === 'list') {
          const activities = await listActivities(userId)
          return ok(activities.map((act) => act.name))
        }
        if (!a.name) return fail(`${a.action} requires name.`)
        if (a.action === 'create') {
          const activity = await createActivity(userId, a.name)
          return ok({ activityId: activity.id, name: activity.name })
        }
        if (!a.newName) return fail('update requires newName: the corrected name.')
        const target = await requireActivityByName(userId, a.name)
        const updated = await editActivity(userId, target.id, a.newName)
        return ok({ activityId: updated.id, name: updated.name })
      }),
  )

  return server
}
