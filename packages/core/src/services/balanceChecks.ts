import { db } from '../db/client.ts'
import { getAccount } from '../db/datasources/accounts.ts'
import { getBalanceCheck, insertBalanceCheck, latestBalanceCheck } from '../db/datasources/balanceChecks.ts'
import { accountBalance } from '../db/datasources/movements.ts'
import { DomainError } from '../domain/errors.ts'
import { today } from '../domain/period.ts'
import type { BalanceCheck, Movement } from '../domain/types.ts'
import { declareMovementIn } from './movements.ts'

export interface BalanceCheckResult {
  check: BalanceCheck
  /** declared minus computed; zero means the books match reality. */
  gap: number
}

function gapOf(check: BalanceCheck): number {
  return Math.round((Number(check.declaredBalance) - Number(check.computedBalance)) * 100) / 100
}

/**
 * The declarative safety net: compare the real balance (read in the banking
 * app) with what the recorded movements add up to. A non-zero gap means
 * undeclared movements; it is settled by declaring them or by an explicit
 * adjustment, never silently.
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

/**
 * Settles a gap with an explicit, categorizable movement dated at the check,
 * against an actor of the user's choice (e.g. an "Unknown" actor).
 */
export async function createAdjustment(
  userId: string,
  balanceCheckId: string,
  input: { actorId: string; categoryId?: string; note?: string },
): Promise<Movement> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const check = await getBalanceCheck(tx, userId, balanceCheckId)
    if (!check) throw new DomainError('check_not_found', `No balance check ${balanceCheckId} for this user`)
    const gap = gapOf(check)
    if (gap === 0) throw new DomainError('no_gap', 'This balance check has no gap to settle')
    const missingIncome = gap > 0
    return await declareMovementIn(tx, userId, {
      happenedOn: check.checkedOn,
      amount: Math.abs(gap),
      sourceAccountId: missingIncome ? undefined : check.accountId,
      targetActorId: missingIncome ? undefined : input.actorId,
      sourceActorId: missingIncome ? input.actorId : undefined,
      targetAccountId: missingIncome ? check.accountId : undefined,
      categoryId: input.categoryId,
      note: input.note ?? 'Balance adjustment',
      balanceCheckId,
    })
  })
}
