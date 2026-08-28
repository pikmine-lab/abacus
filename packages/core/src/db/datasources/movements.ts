import type { SortChoice } from '../../domain/sort.ts'
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
  /** Out of every analysis, while still counted in balances. */
  ghost?: boolean
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
  /** How the selection is ordered; the date, newest first, by default. */
  sort?: SortChoice<MovementSortField>
}

/**
 * What a movement list can be ordered on: the columns a reader sees, and
 * nothing else. Three of them are names held elsewhere, so the sort joins what
 * it needs rather than ordering on an id, which would rank by nothing.
 */
export type MovementSortField = 'date' | 'counterparty' | 'account' | 'category' | 'amount'

/** Whether ordering needs the names, which only three criteria do. */
function sortsOnName(field: MovementSortField): boolean {
  return field === 'counterparty' || field === 'account' || field === 'category'
}

function orderKey(tx: Executor, field: MovementSortField) {
  switch (field) {
    case 'amount':
      return tx`m.amount`
    // The counterparty as the row reads it: the actor on either side, and on a
    // transfer the account the money left, which is what its label starts with.
    case 'counterparty':
      return tx`case when m.kind = 'transfer' then sac.name else coalesce(sa.name, ta.name) end`
    // The owned account the money moved on. A transfer names no single one, so
    // it sorts as unknown and lands at the end, where the row says so too.
    case 'account':
      return tx`case when m.kind = 'transfer' then null else coalesce(sac.name, tac.name) end`
    case 'category':
      return tx`cat.name`
    default:
      return tx`m.happened_on`
  }
}

/**
 * The ordering clause. The date and the creation stamp close every sort, so
 * two rows carrying the same amount never swap places between two reads: a
 * list that reshuffles under an unchanged filter reads as data moving.
 */
function movementOrder(tx: Executor, sort: SortChoice<MovementSortField>) {
  const key = orderKey(tx, sort.field)
  const way = sort.direction === 'asc' ? tx`asc` : tx`desc`
  return tx`order by ${key} ${way} nulls last, m.happened_on desc, m.created_at desc`
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
  const sort = f.sort ?? { field: 'date' as const, direction: 'desc' as const }
  // Only when the order asks for them: a list read by date pays for no join.
  const named = sortsOnName(sort.field)
  return await tx<Movement[]>`
    select m.* from movement m
    ${
      named
        ? tx`left join actor sa on sa.id = m.source_actor_id
             left join actor ta on ta.id = m.target_actor_id
             left join account sac on sac.id = m.source_account_id
             left join account tac on tac.id = m.target_account_id
             left join category cat on cat.id = m.category_id`
        : tx``
    }
    ${movementWhere(tx, userId, f)}
    ${movementOrder(tx, sort)}
    limit ${f.limit ?? 100}
  `
}

export interface MovementSelection {
  count: string
  expense: string
  income: string
  transfer: string
}

/**
 * Totals of the current selection, so a filtered list carries its own sum.
 *
 * The sums leave ghosts out, as every analysis does: a selection answering a
 * different figure than the Analyse screen for the same period would make one
 * of the two wrong without saying which. The count does not: it says how many
 * rows the selection holds, which is what the list shows and what "afficher
 * plus" counts down.
 */
export async function selectionTotals(
  tx: Executor,
  userId: string,
  f: MovementFilters = {},
): Promise<MovementSelection> {
  const [row] = await tx<MovementSelection[]>`
    select count(*) as count,
           coalesce(sum(m.amount) filter (where m.kind = 'expense' and m.ghost = false), 0)::numeric(14,2) as expense,
           coalesce(sum(m.amount) filter (where m.kind = 'income' and m.ghost = false), 0)::numeric(14,2) as income,
           coalesce(sum(m.amount) filter (where m.kind = 'transfer' and m.ghost = false), 0)::numeric(14,2) as transfer
    from movement m
    ${movementWhere(tx, userId, f)}
  `
  return row!
}

/**
 * What the account held on that day: its opening plus the signed sum of
 * everything that entered and left it. `except` leaves one movement out, which
 * is how a balance check is recomputed without counting the adjustment it
 * produced.
 */
export async function accountBalance(
  tx: Executor,
  accountId: string,
  upTo?: string,
  except?: string,
): Promise<string> {
  const [row] = await tx<{ balance: string }[]>`
    select (
      -- Where the account started. A check dated before it compares against
      -- nothing, which is why the opening carries its day: without this the
      -- first check of an account taken over would report a gap equal to
      -- everything that happened before the ledger.
      coalesce((
        select opening_balance from account
        where id = ${accountId}
        ${upTo ? tx`and opened_on <= ${upTo}` : tx``}
      ), 0)
      + coalesce((
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
