import { db } from '../db/client.ts'
import { getAccount } from '../db/datasources/accounts.ts'
import {
  type BalanceCheckRow,
  deleteBalanceCheckRow,
  getBalanceCheck,
  insertBalanceCheck,
  latestBalanceCheck,
  listBalanceChecks,
  updateBalanceCheckRow,
} from '../db/datasources/balanceChecks.ts'
import { accountBalance, movementByBalanceCheck } from '../db/datasources/movements.ts'
import { DomainError, rethrowUnique } from '../domain/errors.ts'
import { today } from '../domain/period.ts'
import type { BalanceCheck, Movement } from '../domain/types.ts'
import { correctMovementIn, declareMovementIn, deleteMovementIn } from './movements.ts'

export interface BalanceCheckResult {
  check: BalanceCheck
  /** declared minus computed; zero means the books match reality. */
  gap: number
}

export interface BalanceCheckEntry extends BalanceCheckResult {
  /** The adjustment that settled the gap, when one was created. */
  adjustmentId: string | null
}

export interface BalanceCheckCorrection extends BalanceCheckEntry {
  /** What became of the adjustment that settled the previous gap. */
  adjustment: 'realigned' | 'removed' | 'none'
}

function gapOf(check: BalanceCheck): number {
  return Math.round((Number(check.declaredBalance) - Number(check.computedBalance)) * 100) / 100
}

/**
 * The declarative safety net: compare the real balance (read in the banking
 * app) with what the recorded movements add up to. A non-zero gap means
 * undeclared movements; it is settled by declaring them or by an explicit
 * adjustment, never silently.
 *
 * On an investment account what is checked is the cash, never the holdings:
 * their value comes from a price nobody here declares, so a gap measured
 * against it would be permanent by construction and would no longer say
 * anything about a missing entry.
 */
export async function recordBalanceCheck(
  userId: string,
  accountId: string,
  declaredBalance: number,
  checkedOn?: string,
  note?: string,
): Promise<BalanceCheckResult> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const account = await getAccount(tx, userId, accountId)
    if (!account) throw new DomainError('account_not_found', `No account ${accountId} for this user`)
    const on = checkedOn ?? today()
    const computed = await accountBalance(tx, accountId, on)
    const check = await insertBalanceCheck(tx, {
      userId,
      accountId,
      checkedOn: on,
      declaredBalance,
      computedBalance: computed,
      note: note ?? null,
    })
    return { check, gap: gapOf(check) }
  })
}

export async function latestCheck(userId: string, accountId: string): Promise<BalanceCheckResult | null> {
  const check = await latestBalanceCheck(db(), userId, accountId)
  return check ? { check, gap: gapOf(check) } : null
}

/** The checks of an account (or of every account), most recent first. */
export async function listChecks(
  userId: string,
  accountId?: string,
  limit?: number,
): Promise<BalanceCheckEntry[]> {
  const rows = await listBalanceChecks(db(), userId, accountId, limit)
  return rows.map((row) => entryOf(row))
}

function entryOf(row: BalanceCheckRow): BalanceCheckEntry {
  const { adjustmentId, ...check } = row
  return { check, gap: gapOf(check), adjustmentId }
}

/** Fields a correction may touch; anything absent keeps its current value. */
export interface BalanceCheckEdit {
  declaredBalance?: number
  checkedOn?: string
  note?: string | null
}

/**
 * Corrects a recorded check. Correcting one is re-checking: the computed side
 * is recomputed from the history as it stands now, for the corrected date, so
 * the gap says what a check recorded today would say. The stored snapshot is
 * what the app computed, not an assertion of the user's, so it follows.
 *
 * The adjustment that settled the previous gap follows too: realigned on the
 * new gap, deleted when there is nothing left to settle. Left alone it would
 * state a debit nobody could trace back to anything.
 */
export async function correctBalanceCheck(
  userId: string,
  id: string,
  input: BalanceCheckEdit,
): Promise<BalanceCheckCorrection> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const current = await getBalanceCheck(tx, userId, id)
    if (!current) throw new DomainError('check_not_found', `No balance check ${id} for this user`)
    const adjustment = await movementByBalanceCheck(tx, id)
    const checkedOn = input.checkedOn ?? current.checkedOn
    // The check's own adjustment is not part of what the books say happened on
    // the account: counting it would make every gap settle itself.
    const computed = await accountBalance(tx, current.accountId, checkedOn, adjustment?.id)
    const check = (await updateBalanceCheckRow(tx, userId, id, {
      checkedOn,
      declaredBalance: input.declaredBalance ?? Number(current.declaredBalance),
      computedBalance: computed,
      note: input.note !== undefined ? input.note : current.note,
    }))!
    const gap = gapOf(check)
    if (!adjustment) return { check, gap, adjustmentId: null, adjustment: 'none' }
    if (gap === 0) {
      await deleteMovementIn(tx, userId, adjustment.id)
      return { check, gap, adjustmentId: null, adjustment: 'removed' }
    }
    await correctMovementIn(tx, userId, adjustment.id, {
      happenedOn: checkedOn,
      ...adjustmentEndpoints(gap, check.accountId, actorOf(adjustment)),
      amount: Math.abs(gap),
    })
    return { check, gap, adjustmentId: adjustment.id, adjustment: 'realigned' }
  })
}

/**
 * Removes a check. Its adjustment goes with it: that movement exists only to
 * settle this check's gap, so on its own it would state a debit with no story.
 */
export async function deleteBalanceCheck(userId: string, id: string): Promise<void> {
  const sql = db()
  await sql.begin(async (tx) => {
    const check = await getBalanceCheck(tx, userId, id)
    if (!check) throw new DomainError('check_not_found', `No balance check ${id} for this user`)
    const adjustment = await movementByBalanceCheck(tx, id)
    if (adjustment) await deleteMovementIn(tx, userId, adjustment.id)
    await deleteBalanceCheckRow(tx, userId, id)
  })
}

/** The actor an adjustment is attributed to, whichever side it sits on. */
function actorOf(adjustment: Movement): string {
  return (adjustment.targetActorId ?? adjustment.sourceActorId)!
}

interface AdjustmentEndpoints {
  sourceAccountId: string | null
  targetActorId: string | null
  sourceActorId: string | null
  targetAccountId: string | null
}

/**
 * Which way an adjustment points. A positive gap means inflows are missing, so
 * the money comes from the actor; a negative one means outflows are, so it
 * leaves the account. A corrected gap that changed sign flips the movement,
 * which is why the unused side is an explicit null and not an omission.
 */
function adjustmentEndpoints(gap: number, accountId: string, actorId: string): AdjustmentEndpoints {
  const missingIncome = gap > 0
  return {
    sourceAccountId: missingIncome ? null : accountId,
    targetActorId: missingIncome ? null : actorId,
    sourceActorId: missingIncome ? actorId : null,
    targetAccountId: missingIncome ? accountId : null,
  }
}

/**
 * Settles a gap with an explicit, categorizable movement dated at the check,
 * against an actor of the user's choice (e.g. an "Unknown" actor).
 *
 * The adjustment is a movement like any other, so it enters the analysis:
 * money really did leave (or reach) the account. `ghost` is offered here
 * rather than assumed, because only the user knows which of the two a gap is:
 * a regularisation that explains nothing, or entries that were forgotten and
 * whose amount belongs in the period's total.
 */
export async function createAdjustment(
  userId: string,
  balanceCheckId: string,
  input: { actorId: string; categoryId?: string; note?: string; ghost?: boolean },
): Promise<Movement> {
  const sql = db()
  try {
    return await sql.begin(async (tx) => {
      const check = await getBalanceCheck(tx, userId, balanceCheckId)
      if (!check) throw new DomainError('check_not_found', `No balance check ${balanceCheckId} for this user`)
      const gap = gapOf(check)
      if (gap === 0) throw new DomainError('no_gap', 'This balance check has no gap to settle')
      const endpoints = adjustmentEndpoints(gap, check.accountId, input.actorId)
      return await declareMovementIn(tx, userId, {
        happenedOn: check.checkedOn,
        amount: Math.abs(gap),
        sourceAccountId: endpoints.sourceAccountId ?? undefined,
        targetActorId: endpoints.targetActorId ?? undefined,
        sourceActorId: endpoints.sourceActorId ?? undefined,
        targetAccountId: endpoints.targetAccountId ?? undefined,
        categoryId: input.categoryId,
        note: input.note ?? 'Balance adjustment',
        ghost: input.ghost,
        balanceCheckId,
      })
    })
  } catch (e) {
    rethrowUnique(
      e,
      'check_already_settled',
      'An adjustment already settles this balance check: correct or delete that movement instead',
    )
  }
}
