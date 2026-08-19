import type { BalanceCheck } from '../../domain/types.ts'
import { compact, type Executor } from '../client.ts'

export async function insertBalanceCheck(
  tx: Executor,
  row: {
    userId: string
    accountId: string
    checkedOn: string
    declaredBalance: number
    computedBalance: string
    note?: string | null
  },
): Promise<BalanceCheck> {
  const [check] = await tx<BalanceCheck[]>`insert into balance_check ${tx(compact(row))} returning *`
  return check!
}

export async function getBalanceCheck(
  tx: Executor,
  userId: string,
  id: string,
): Promise<BalanceCheck | undefined> {
  const [check] = await tx<BalanceCheck[]>`select * from balance_check where user_id = ${userId} and id = ${id}`
  return check
}

export async function latestBalanceCheck(
  tx: Executor,
  userId: string,
  accountId: string,
): Promise<BalanceCheck | undefined> {
  const [check] = await tx<BalanceCheck[]>`
    select * from balance_check
    where user_id = ${userId} and account_id = ${accountId}
    order by checked_on desc, created_at desc
    limit 1
  `
  return check
}
