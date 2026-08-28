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
  const [check] = await tx<
    BalanceCheck[]
  >`select * from balance_check where user_id = ${userId} and id = ${id}`
  return check
}

/** A check and the adjustment that settled its gap, if one was created. */
export type BalanceCheckRow = BalanceCheck & { adjustmentId: string | null }

export async function latestBalanceCheck(
  tx: Executor,
  userId: string,
  accountId: string,
): Promise<BalanceCheckRow | undefined> {
  const [check] = await tx<BalanceCheckRow[]>`
    select c.*, m.id as adjustment_id
    from balance_check c
    left join movement m on m.balance_check_id = c.id
    where c.user_id = ${userId} and c.account_id = ${accountId}
    order by c.checked_on desc, c.created_at desc
    limit 1
  `
  return check
}

export async function listBalanceChecks(
  tx: Executor,
  userId: string,
  accountId?: string,
  limit = 50,
): Promise<BalanceCheckRow[]> {
  return await tx<BalanceCheckRow[]>`
    select c.*, m.id as adjustment_id
    from balance_check c
    left join movement m on m.balance_check_id = c.id
    where c.user_id = ${userId}
    ${accountId ? tx`and c.account_id = ${accountId}` : tx``}
    order by c.checked_on desc, c.created_at desc
    limit ${limit}
  `
}

export async function updateBalanceCheckRow(
  tx: Executor,
  userId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<BalanceCheck | undefined> {
  const [check] = await tx<BalanceCheck[]>`
    update balance_check set ${tx(patch)} where user_id = ${userId} and id = ${id} returning *
  `
  return check
}

export async function deleteBalanceCheckRow(tx: Executor, userId: string, id: string): Promise<number> {
  const rows = await tx`delete from balance_check where user_id = ${userId} and id = ${id}`
  return rows.count
}
