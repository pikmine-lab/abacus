import type { Movement, MovementKind, Reading } from '../../domain/types.ts'
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
  expectedRefundAmount?: number | null
  refundsMovementId?: string | null
  originalAmount?: number | null
  originalCurrency?: string | null
  /** First day of the month the movement is about; null follows its date. */
  accrualMonth?: string | null
}

export async function insertMovement(tx: Executor, row: NewMovement): Promise<Movement> {
  const [movement] = await tx<Movement[]>`insert into movement ${tx(compact(row))} returning *`
  return movement!
}

export async function updateMovementRow(
  tx: Executor,
  userId: string,
  id: string,
  row: Partial<NewMovement>,
): Promise<Movement | undefined> {
  const [movement] = await tx<Movement[]>`
    update movement set ${tx(row as Record<string, unknown>)}, updated_at = now()
    where user_id = ${userId} and id = ${id}
    returning *
  `
  return movement
}

export async function deleteMovementRow(tx: Executor, userId: string, id: string): Promise<number> {
  const rows = await tx`delete from movement where user_id = ${userId} and id = ${id}`
  return rows.count
}

export async function getMovement(tx: Executor, userId: string, id: string): Promise<Movement | undefined> {
  const [movement] = await tx<Movement[]>`select * from movement where user_id = ${userId} and id = ${id}`
  return movement
}

export interface MovementFilters {
  from?: string
  to?: string
  /**
   * What the window above selects on: the settlement day (`cash`, the
   * default), or the month the movement is about (`accrual`, which rounds the
   * window out to whole months, as every accrual reading does).
   */
  reading?: Reading
  kind?: MovementKind
  accountId?: string
  actorId?: string
  categoryId?: string
  activityId?: string
  commitmentId?: string
  /** Free text, matched on the note and on the counterparty's name. */
  search?: string
  /** Only expenses still awaiting a refund. */
  advancesOnly?: boolean
  limit?: number
}

/**
 * The filter clauses, written once: the list and its count must agree on what
 * "the current selection" means, and two copies of this would drift.
 */
function movementWhere(tx: Executor, userId: string, f: MovementFilters) {
  const term = f.search?.trim() ? `%${f.search.trim()}%` : null
  const accrual = f.reading === 'accrual'
  return tx`
    where m.user_id = ${userId}
    ${f.from ? (accrual ? tx`and m.counted_in_month >= date_trunc('month', ${f.from}::date)` : tx`and m.happened_on >= ${f.from}`) : tx``}
    ${f.to ? (accrual ? tx`and m.counted_in_month <= date_trunc('month', ${f.to}::date)` : tx`and m.happened_on <= ${f.to}`) : tx``}
    ${f.kind ? tx`and m.kind = ${f.kind}` : tx``}
    ${f.accountId ? tx`and (m.source_account_id = ${f.accountId} or m.target_account_id = ${f.accountId})` : tx``}
    ${f.actorId ? tx`and (m.source_actor_id = ${f.actorId} or m.target_actor_id = ${f.actorId})` : tx``}
    ${f.categoryId ? tx`and m.category_id = ${f.categoryId}` : tx``}
    ${f.activityId ? tx`and m.activity_id = ${f.activityId}` : tx``}
    ${f.commitmentId ? tx`and m.commitment_id = ${f.commitmentId}` : tx``}
    ${
      f.advancesOnly
        ? tx`and m.expected_refund_from_actor_id is not null and m.refund_closed = false
             and m.expected_refund_amount > coalesce(
               (select sum(r.amount) from movement r where r.refunds_movement_id = m.id), 0)`
        : tx``
    }
    ${
      term
        ? tx`and (m.note ilike ${term} or exists (
            select 1 from actor a
            where a.id in (m.source_actor_id, m.target_actor_id) and a.name ilike ${term}
          ))`
        : tx``
    }
  `
}

export async function listMovements(
  tx: Executor,
  userId: string,
  f: MovementFilters = {},
): Promise<Movement[]> {
  return await tx<Movement[]>`
    select m.* from movement m
    ${movementWhere(tx, userId, f)}
    order by m.happened_on desc, m.created_at desc
    limit ${f.limit ?? 100}
  `
}

export interface MovementSelection {
  count: string
  expense: string
  income: string
  transfer: string
}

/** Totals of the current selection, so a filtered list carries its own sum. */
export async function selectionTotals(
  tx: Executor,
  userId: string,
  f: MovementFilters = {},
): Promise<MovementSelection> {
  const [row] = await tx<MovementSelection[]>`
    select count(*) as count,
           coalesce(sum(m.amount) filter (where m.kind = 'expense'), 0)::numeric(14,2) as expense,
           coalesce(sum(m.amount) filter (where m.kind = 'income'), 0)::numeric(14,2) as income,
           coalesce(sum(m.amount) filter (where m.kind = 'transfer'), 0)::numeric(14,2) as transfer
    from movement m
    ${movementWhere(tx, userId, f)}
  `
  return row!
}

/**
 * Signed sum of everything that entered and left the account. `except` leaves
 * one movement out, which is how a balance check is recomputed without
 * counting the adjustment it produced.
 */
export async function accountBalance(
  tx: Executor,
  accountId: string,
  upTo?: string,
  except?: string,
): Promise<string> {
  const [row] = await tx<{ balance: string }[]>`
    select (
      coalesce((
        select sum(case when target_account_id = ${accountId} then amount else -amount end)
        from movement
        where (source_account_id = ${accountId} or target_account_id = ${accountId})
        ${upTo ? tx`and happened_on <= ${upTo}` : tx``}
        ${except ? tx`and id <> ${except}` : tx``}
      ), 0)
      -- Operations move the cash of an investment account just as movements do,
      -- and a balance check compares against its cash: without them the check
      -- would report no gap on an account whose cash is thousands off, which is
      -- the one thing the check exists to catch.
      + coalesce((
        select sum(case when type in ('sell', 'dividend') then amount else -amount end)
        from investment_operation
        where account_id = ${accountId}
        ${upTo ? tx`and operated_on <= ${upTo}` : tx``}
      ), 0)
    )::numeric(14,2) as balance
  `
  return row!.balance
}

export async function countMovementsForCommitment(tx: Executor, commitmentId: string): Promise<number> {
  const [row] = await tx<{ count: string }[]>`
    select count(*) as count from movement where commitment_id = ${commitmentId}
  `
  return Number(row!.count)
}

export async function sumMovementsForCommitment(tx: Executor, commitmentId: string): Promise<string> {
  const [row] = await tx<{ total: string }[]>`
    select coalesce(sum(amount), 0)::numeric(14,2) as total from movement where commitment_id = ${commitmentId}
  `
  return row!.total
}

/**
 * Open advances: expenses awaiting a refund, with what came back so far.
 * What is owed is the expected share, not the whole expense: paying for four
 * and being owed three quarters is the ordinary case. An advance drops out on
 * its own once that share is back; an abandoned one is closed explicitly
 * (refund_closed).
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
      and m.expected_refund_amount > coalesce(r.total, 0)
    order by m.happened_on
  `
}

/** What has already come back on an advance, refund movements linked to it. */
export async function refundedSoFar(tx: Executor, id: string): Promise<string> {
  const [row] = await tx<{ total: string }[]>`
    select coalesce(sum(amount), 0)::numeric(14,2) as total
    from movement where refunds_movement_id = ${id}
  `
  return row!.total
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

/** The adjustment a balance check produced, if its gap was settled. */
export async function movementByBalanceCheck(
  tx: Executor,
  balanceCheckId: string,
): Promise<Movement | undefined> {
  const [movement] = await tx<Movement[]>`
    select * from movement where balance_check_id = ${balanceCheckId}
  `
  return movement
}
