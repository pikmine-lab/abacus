import {
  correctBalanceCheck,
  createAdjustment,
  recordBalanceCheck,
} from '@abacus/core/services/balanceChecks'
import { dayOfMonthAgo, daysAgo } from './calendar.ts'
import type { Ledger } from './ledger.ts'

/**
 * The balance checks, written last because each one freezes what the books
 * said on its day. Together they show every state the accounts screen reads:
 * a fresh check, an old one, a gap still open, a gap settled by an adjustment,
 * and an account never checked (the crypto wallet).
 */
export async function checks(userId: string, { accounts, actors }: Ledger): Promise<void> {
  // The declared balance is the computed one plus the gap wanted. What a check
  // computes depends on the account (the cash only, on an investment account),
  // so the check computes it itself, then is corrected to the figure "read".
  const check = async (accountId: string, on: string, gap = 0) => {
    const { check } = await recordBalanceCheck(userId, accountId, 0, on)
    const declaredBalance = Math.round((Number(check.computedBalance) + gap) * 100) / 100
    return await correctBalanceCheck(userId, check.id, { declaredBalance })
  }

  const settled = await check(accounts.checking, dayOfMonthAgo(2, 27), -23.5)
  await createAdjustment(userId, settled.check.id, {
    actorId: actors.unknown,
    note: 'Retrait non déclaré',
  })
  await check(accounts.checking, daysAgo(2))
  await check(accounts.savings, daysAgo(70))
  await check(accounts.business, daysAgo(6), -12.4)
  await check(accounts.pea, daysAgo(20))
  await check(accounts.lifeInsurance, daysAgo(30))
}
