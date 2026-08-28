import { DomainError } from '@abacus/core/domain/errors'
import { listAccounts } from '@abacus/core/services/accounts'
import { listActors } from '@abacus/core/services/actors'
import { listCategories } from '@abacus/core/services/catalog'
import {
  closeAdvance,
  correctMovement,
  declareMovement,
  deleteMovement,
  listMovements,
  outstandingAdvances,
} from '@abacus/core/services/movements'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import {
  requireAccountByName,
  requireActivityByName,
  requireActorByName,
  requireCategoryByName,
} from '../resolve.ts'
import { clearable, fail, GUIDANCE, isoDate, ok, run } from './shared.ts'

/**
 * An open claim, told in full: what left the account, what is owed back, and
 * the two names a refund declaration needs. The AI reading this never has to
 * look up who or where.
 */
export async function advancesView(userId: string) {
  const [advances, actors, accounts] = await Promise.all([
    outstandingAdvances(userId),
    listActors(userId),
    listAccounts(userId),
  ])
  const actorName = new Map(actors.map((a) => [a.id, a.name]))
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  return advances.map((a) => {
    const owed = Number(a.expectedRefundAmount)
    const refunded = Number(a.refunded)
    return {
      movementId: a.id,
      date: a.happenedOn,
      paidTo: actorName.get(a.targetActorId!) ?? '?',
      paid: Number(a.amount),
      owed,
      refunded,
      remaining: Math.round((owed - refunded) * 100) / 100,
      debtor: actorName.get(a.expectedRefundFromActorId!) ?? '?',
      account: accountName.get(a.sourceAccountId!) ?? '?',
      note: a.note ?? undefined,
    }
  })
}

export function registerMovementTools(server: McpServer, userId: string): void {
  server.registerTool(
    'declare_movements',
    {
      description:
        'Records a batch of movements the user declares: expenses, incomes, internal transfers. This is the daily entry tool. Everything is addressed by NAME (accounts, actors, categories), never by id. An unknown actor fails its own line with suggestions: reuse a close existing actor instead of creating a duplicate ("McDo" and "McDonald\'s" are the same actor), and only pass createUnknownActors: true for genuinely new actors. Amounts are always positive; the direction comes from the type. An expense or income paid in a foreign currency is declared as paid (amount + currency): the EUR counter-value is computed at that day\'s real rate and stored, so never convert yourself; when the bank statement already shows the euros moved, pass them as eurAmount. A movement that concerns a month other than the one the money moved in says so with month (a late salary, a rent paid ahead): that only moves it in the monthly analysis, never in a balance. A movement that reached the account and says nothing about the flows (an insurance payout, a gift, a regularisation) is declared with ghost: true, which keeps it in the balances and out of every analysis. Do not use it for subscription debits (confirm_due_movements) nor to settle a balance-check gap (settle_check_gap). Each line succeeds or fails independently: read the result line by line.',
      inputSchema: z.object({
        movements: z
          .array(
            z.object({
              date: isoDate,
              amount: z
                .number()
                .positive()
                .describe(
                  'Amount, always positive; the direction comes from the type. In euros, or in the currency below when one is given',
                ),
              currency: z
                .string()
                .length(3)
                .optional()
                .describe(
                  "ISO 4217 code the amount was paid in, when not euros (USD, GBP…). Expense/income only. The EUR counter-value is computed at the transaction day's real rate and frozen: never convert yourself",
                ),
              eurAmount: z
                .number()
                .positive()
                .optional()
                .describe(
                  "With a foreign currency only: the euros the bank actually moved, when the statement shows them. Omitted: computed at the day's rate",
                ),
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
              month: z
                .string()
                .regex(/^\d{4}-\d{2}$/)
                .optional()
                .describe(
                  'YYYY-MM: the month this expense or income is ABOUT, when the money did not move in it. August salary paid on September 2nd → 2026-08; September rent paid on August 30th → 2026-09; August-bought tickets for a September trip → 2026-09. It moves the movement in the monthly analysis and never in a balance. Leave it out whenever the money moved in the month it concerns, which is almost always: an occurrence confirmed with confirm_due_movements sets it by itself. Never on a transfer',
                ),
              ghost: z
                .boolean()
                .optional()
                .describe(
                  'true: the movement counts in every balance and in no analysis (period totals, breakdowns, monthly curve). For what really reached the account but tells nothing about the flows: an insurance payout, a gift received, a regularisation, money coming from an account that is not tracked. An ordinary expense is never a ghost, however large: ask the user rather than deciding. Never on a transfer, which already counts in no total',
                ),
              note: z.string().optional(),
              expectedRefundFrom: z
                .string()
                .optional()
                .describe(
                  "Expense advanced on someone's behalf: name of the actor who owes the refund. Requires expectedRefundAmount",
                ),
              expectedRefundAmount: z
                .number()
                .positive()
                .optional()
                .describe(
                  'How much of this expense is owed back, in euros, at most the amount. Mandatory with expectedRefundFrom: paying 120 and being owed 90 is the ordinary case, so the share is never assumed',
                ),
              alreadyRefunded: z
                .boolean()
                .optional()
                .describe(
                  'The money came back the same day: the refund income is written too, so the balance is right without a second call. Leave it out when the refund is still awaited',
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
            currency: m.currency,
            eurAmount: m.eurAmount,
            sourceAccountId,
            sourceActorId,
            targetAccountId,
            targetActorId,
            categoryId,
            activityId,
            note: m.note,
            accrualMonth: m.month,
            ghost: m.ghost,
            expectedRefundFromActorId,
            expectedRefundAmount: m.expectedRefundAmount,
            refundedNow: m.alreadyRefunded,
            refundsMovementId: m.refundsMovementId,
          })
          results.push({
            index,
            ok: true,
            movementId: movement.id,
            kind: movement.kind,
            ...(movement.accrualMonth ? { month: movement.accrualMonth.slice(0, 7) } : {}),
            ...(movement.ghost ? { ghost: true } : {}),
            // Echo the conversion so the user can hear what was written.
            ...(movement.originalCurrency
              ? {
                  paid: `${Number(movement.originalAmount)} ${movement.originalCurrency}`,
                  eurAmount: Number(movement.amount),
                }
              : {}),
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
        'Browses the movement history, filterable by period, type, account, actor, category or activity (all by name). Each line carries its account, its counterparty and its category, so what was declared can be read back and checked, plus month when it is attached to a month other than its own, and ghost when it is left out of the analyses. Use it to see what is already there before an entry, to find the id of a movement to repair with fix_movement, or to answer "how much did I spend at X". For grouped totals, prefer analyze_flows.',
      inputSchema: z.object({
        from: isoDate.optional(),
        to: isoDate.optional(),
        reading: z
          .enum(['cash', 'accrual'])
          .optional()
          .describe(
            'What from/to select on. cash (default): the day the money moved. accrual: the month each movement is about, so a salary paid on September 2nd for August comes back in August. An accrual window covers whole months (a month is the finest attachment there is), so it rounds out to them',
          ),
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
          reading: f.reading,
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
            // Absent when the movement counts in the month of its own date.
            ...(m.accrualMonth ? { month: m.accrualMonth.slice(0, 7) } : {}),
            // Absent unless the movement is out of the analyses.
            ...(m.ghost ? { ghost: true } : {}),
            kind: m.kind,
            amount: Number(m.amount),
            // Declared in a foreign currency: amount is its EUR counter-value.
            ...(m.originalCurrency ? { paid: `${Number(m.originalAmount)} ${m.originalCurrency}` } : {}),
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
    'list_outstanding_advances',
    {
      description:
        'Open claims: expenses advanced on someone\'s behalf, awaiting a refund. Each one says what left the account (paid) and what is owed back (owed), which are the same figure only when the whole expense was advanced. When a refund arrives, declare it with declare_movements as an income of the amount received, on the listed account, from the listed debtor, with refundsMovementId set to this movementId: the claim then closes itself, in one go or refund after refund. An abandoned claim ("they will never pay the rest") is closed with close_advance instead: it leaves this list and the expense stays whole.',
      inputSchema: z.object({}),
    },
    async () => run(async () => ok(await advancesView(userId))),
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
    'fix_movement',
    {
      description:
        'Repairs an already declared movement: correct what was mistyped, or delete what should never have been recorded (a duplicate, an entry that turned out not to have happened). Get the id from list_movements first: this tool never guesses which movement is meant. Correcting rebuilds the movement from what you pass: give the type and every field that applies to it, exactly as with declare_movements, because switching an expense to a transfer has to drop its actor and its category. What it never touches: the links to an origin (a confirmed occurrence, a balance-check adjustment) and the link tying a received refund to the advance it repaid. The claim itself is repairable: expectedRefundFrom and expectedRefundAmount fix who owes and how much, and "none" drops the claim entirely (refused while a refund is already linked to it). Deleting is not how you undo a confirmed occurrence: the commitment has already moved on and would need manage_subscription. Prefer correcting over delete-then-redeclare: the movement keeps its identity and its links. Correcting the amount or the date of a movement that settled a financing installment realigns that installment too, so the plan keeps saying what was really paid, and when. On a movement declared in a foreign currency, amount alone corrects the euros that hit the account (what the bank statement shows) and leaves the paid amount as declared; correcting the date alone keeps the euros too; pass currency to redeclare the paid side and reconvert at the day\'s rate. The month it is about is repairable the same way: month attaches it, "none" detaches it, and leaving it out keeps what is stored, so a date fix never moves a month that was stated on purpose. Being out of the analyses is repairable too: ghost true takes it out, false brings it back, absent keeps it.',
      inputSchema: z.object({
        movement: z.string().describe('Id of the movement, from list_movements'),
        action: z.enum(['correct', 'delete']),
        date: isoDate.optional().describe('correct: the real date'),
        amount: z
          .number()
          .positive()
          .optional()
          .describe(
            'correct: the real amount, always positive. Alone: the euros that hit the account. With currency: what was paid in that currency',
          ),
        currency: z
          .string()
          .length(3)
          .optional()
          .describe(
            'correct: redeclares the money side, as on declaration. A foreign ISO code converts the amount at the day\'s rate (unless eurAmount gives the bank\'s figure); "EUR" drops a wrongly declared foreign original. Absent: the stored original is kept',
          ),
        eurAmount: z
          .number()
          .positive()
          .optional()
          .describe('correct, with a foreign currency only: the euros the bank actually moved'),
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
        month: z
          .string()
          .optional()
          .describe(
            'correct: YYYY-MM, the month this movement is about when the money did not move in it, or "none" to detach it (it then follows its date again). Absent: the stored month is kept, so correcting a date never moves a month that was stated on purpose',
          ),
        ghost: z
          .boolean()
          .optional()
          .describe(
            'correct: true leaves the movement out of every analysis while keeping it in the balances, false brings it back in. Absent: the stored value is kept',
          ),
        expectedRefundFrom: z
          .string()
          .optional()
          .describe(
            'correct, expense only: name of the actor who owes a refund, or "none" to drop the claim',
          ),
        expectedRefundAmount: z
          .number()
          .positive()
          .optional()
          .describe(
            'correct: how much of the expense is owed back, in euros. Required when expectedRefundFrom names an actor the movement did not already owe to',
          ),
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
        const debtor = clearable(f.expectedRefundFrom)
        const movement = await correctMovement(userId, f.movement, {
          happenedOn: f.date,
          amount: f.amount,
          currency: f.currency,
          eurAmount: f.eurAmount,
          ...endpoints,
          categoryId: category ? (await requireCategoryByName(userId, category)).id : category,
          activityId: activity ? (await requireActivityByName(userId, activity)).id : activity,
          note: clearable(f.note),
          accrualMonth: clearable(f.month),
          ghost: f.ghost,
          expectedRefundFromActorId: debtor ? (await requireActorByName(userId, debtor)).actor.id : debtor,
          // Dropping the debtor drops the amount with it: half a claim is not a
          // state the model has.
          expectedRefundAmount: debtor === null ? null : f.expectedRefundAmount,
        })
        return ok({
          movementId: movement.id,
          date: movement.happenedOn,
          ...(movement.accrualMonth ? { month: movement.accrualMonth.slice(0, 7) } : {}),
          ...(movement.ghost ? { ghost: true } : {}),
          amount: Number(movement.amount),
          kind: movement.kind,
          ...(movement.originalCurrency
            ? { paid: `${Number(movement.originalAmount)} ${movement.originalCurrency}` }
            : {}),
        })
      }),
  )
}
