import type { Movement, MovementKind } from '../../domain/types.ts'
import { compact, type Executor } from '../client.ts'

export interface NewMovement {
  userId: string
  happenedOn: string
  amount: number
  currency?: string
  sourceAccountId?: string | null
  sourceActorId?: string | null
  targetAccountId?: string | null
  targetActorId?: string | null
  categoryId?: string | null
  activityId?: string | null
  note?: string | null
  commitmentId?: string | null
  balanceCheckId?: string | null
  expectedRefundFromActorId?: string | null
  refundsMovementId?: string | null
}

export async function insertMovement(tx: Executor, row: NewMovement): Promise<Movement> {
  const [movement] = await tx<Movement[]>`insert into movement ${tx(compact(row))} returning *`
  return movement!
}

export async function getMovement(tx: Executor, userId: string, id: string): Promise<Movement | undefined> {
  const [movement] = await tx<Movement[]>`select * from movement where user_id = ${userId} and id = ${id}`
  return movement
}

export interface MovementFilters {
  from?: string
  to?: string
  kind?: MovementKind
  accountId?: string
  actorId?: string
  categoryId?: string
  activityId?: string
  commitmentId?: string
  limit?: number
}

export async function listMovements(
  tx: Executor,
  userId: string,
  f: MovementFilters = {},
): Promise<Movement[]> {
  return await tx<Movement[]>`
    select * from movement
    where user_id = ${userId}
    ${f.from ? tx`and happened_on >= ${f.from}` : tx``}
    ${f.to ? tx`and happened_on <= ${f.to}` : tx``}
    ${f.kind ? tx`and kind = ${f.kind}` : tx``}
    ${f.accountId ? tx`and (source_account_id = ${f.accountId} or target_account_id = ${f.accountId})` : tx``}
    ${f.actorId ? tx`and (source_actor_id = ${f.actorId} or target_actor_id = ${f.actorId})` : tx``}
    ${f.categoryId ? tx`and category_id = ${f.categoryId}` : tx``}
    ${f.activityId ? tx`and activity_id = ${f.activityId}` : tx``}
    ${f.commitmentId ? tx`and commitment_id = ${f.commitmentId}` : tx``}
    order by happened_on desc, created_at desc
    limit ${f.limit ?? 100}
  `
}

/** Signed sum of everything that entered and left the account. */
export async function accountBalance(tx: Executor, accountId: string, upTo?: string): Promise<string> {
  const [row] = await tx<{ balance: string }[]>`
    select coalesce(sum(case when target_account_id = ${accountId} then amount else -amount end), 0)::numeric(14,2) as balance
    from movement
    where (source_account_id = ${accountId} or target_account_id = ${accountId})
    ${upTo ? tx`and happened_on <= ${upTo}` : tx``}
  `
  return row!.balance
}

export async function countMovementsForCommitment(tx: Executor, commitmentId: string): Promise<number> {
  const [row] = await tx<{ count: string }[]>`
    select count(*) as count from movement where commitment_id = ${commitmentId}
  `
  return Number(row!.count)
}

/**
 * Open advances: expenses awaiting a refund, with what came back so far.
 * Fully refunded ones drop out on their own; abandoned ones are closed
 * explicitly (refund_closed).
 */
export async function listOutstandingAdvances(
  tx: Executor,
  userId: string,
): Promise<(Movement & { refunded: string })[]> {
  return await tx<(Movement & { refunded: string })[]>`
    select m.*, coalesce(r.total, 0)::numeric(14,2) as refunded
    from movement m
    left join lateral (
      select sum(amount) as total from movement r where r.refunds_movement_id = m.id
    ) r on true
    where m.user_id = ${userId}
      and m.expected_refund_from_actor_id is not null
      and m.refund_closed = false
      and m.amount > coalesce(r.total, 0)
    order by m.happened_on
  `
}

export async function setRefundClosed(
  tx: Executor,
  userId: string,
  id: string,
  closed: boolean,
): Promise<Movement | undefined> {
  const [movement] = await tx<Movement[]>`
    update movement set refund_closed = ${closed}, updated_at = now()
    where user_id = ${userId} and id = ${id}
    returning *
  `
  return movement
}
