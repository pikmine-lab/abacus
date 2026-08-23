import { listAccounts } from '@abacus/core/services/accounts'
import {
  correctBalanceCheck,
  createAdjustment,
  deleteBalanceCheck,
  listChecks,
  recordBalanceCheck,
} from '@abacus/core/services/balanceChecks'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { requireAccountByName, requireActorByName, requireCategoryByName } from '../resolve.ts'
import { clearable, fail, isoDate, ok, run } from './shared.ts'

export function registerBalanceCheckTools(server: McpServer, userId: string): void {
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
}
