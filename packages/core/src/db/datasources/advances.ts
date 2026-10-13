import type { AdvanceShare, ShareInstallment, ShareState } from '../../domain/types.ts'
import { compact, type Executor } from '../client.ts'

export interface NewShare {
  userId: string
  movementId?: string | null
  commitmentId?: string | null
  perOccurrence?: boolean
  debtorActorId: string
  amount: number
}

/** What came back on a share: the refunds pointing at it, ghosts included. */
function state(tx: Executor) {
  return tx`s.*, coalesce(r.total, 0)::numeric(14,2) as refunded, r.last_on as last_refunded_on`
}

function refundsOf(tx: Executor) {
  return tx`
    left join lateral (
      select sum(amount) as total, max(happened_on) as last_on
      from movement r where r.refunds_share_id = s.id
    ) r on true
  `
}

export async function insertShare(tx: Executor, row: NewShare): Promise<AdvanceShare> {
  const [share] = await tx<AdvanceShare[]>`insert into advance_share ${tx(compact(row))} returning *`
  return share!
}

export async function updateShareAmount(tx: Executor, id: string, amount: number): Promise<void> {
  await tx`update advance_share set amount = ${amount}, updated_at = now() where id = ${id}`
}

export async function setShareClosed(tx: Executor, id: string, closed: boolean): Promise<void> {
  await tx`update advance_share set closed = ${closed}, updated_at = now() where id = ${id}`
}

export async function deleteShare(tx: Executor, id: string): Promise<void> {
  await tx`delete from advance_share where id = ${id}`
}

/** One share with what came back on it, locked for the rest of the transaction. */
export async function getShareForUpdate(
  tx: Executor,
  userId: string,
  id: string,
): Promise<ShareState | undefined> {
  const [share] = await tx<ShareState[]>`
    select ${state(tx)}
    from advance_share s ${refundsOf(tx)}
    where s.user_id = ${userId} and s.id = ${id}
    for update of s
  `
  return share
}

/** Some shares with what came back on each, read without locking them. */
export async function sharesByIds(tx: Executor, userId: string, ids: string[]): Promise<ShareState[]> {
  if (ids.length === 0) return []
  return await tx<ShareState[]>`
    select ${state(tx)}
    from advance_share s ${refundsOf(tx)}
    where s.user_id = ${userId} and s.id in ${tx(ids)}
  `
}

export async function sharesOfMovement(tx: Executor, movementId: string): Promise<ShareState[]> {
  return await tx<ShareState[]>`
    select ${state(tx)}
    from advance_share s ${refundsOf(tx)}
    where s.movement_id = ${movementId}
    order by s.created_at, s.id
  `
}

export async function sharesOfMovements(tx: Executor, movementIds: string[]): Promise<ShareState[]> {
  if (movementIds.length === 0) return []
  return await tx<ShareState[]>`
    select ${state(tx)}
    from advance_share s ${refundsOf(tx)}
    where s.movement_id in ${tx(movementIds)}
    order by s.created_at, s.id
  `
}

export async function sharesOfCommitments(tx: Executor, commitmentIds: string[]): Promise<ShareState[]> {
  if (commitmentIds.length === 0) return []
  return await tx<ShareState[]>`
    select ${state(tx)}
    from advance_share s ${refundsOf(tx)}
    where s.commitment_id in ${tx(commitmentIds)}
    order by s.created_at, s.id
  `
}

/** What the refunds of a share add up to, one of them left out when it is the one being corrected. */
export async function refundedOnShare(tx: Executor, shareId: string, except?: string): Promise<number> {
  const [row] = await tx<{ total: string }[]>`
    select coalesce(sum(amount), 0)::numeric(14,2) as total
    from movement
    where refunds_share_id = ${shareId} ${except ? tx`and id <> ${except}` : tx``}
  `
  return Number(row!.total)
}

/** Turns the refunds of a share back into plain incomes. */
export async function detachRefunds(tx: Executor, shareId: string): Promise<string[]> {
  const rows = await tx<{ id: string }[]>`
    update movement set refunds_share_id = null, updated_at = now()
    where refunds_share_id = ${shareId}
    returning id
  `
  return rows.map((r) => r.id)
}

/**
 * The claims still awaited: shares of an expense or of a financing's total,
 * not written off, with less back than owed. A share per occurrence is a rule,
 * never awaited itself: its occurrences are, on their movements.
 */
export async function listOpenShares(tx: Executor, userId: string): Promise<ShareState[]> {
  return await tx<ShareState[]>`
    select ${state(tx)}
    from advance_share s ${refundsOf(tx)}
    where s.user_id = ${userId}
      and not s.per_occurrence
      and not s.closed
      and s.amount > coalesce(r.total, 0)
    order by s.created_at, s.id
  `
}

export async function installmentsOfShares(tx: Executor, shareIds: string[]): Promise<ShareInstallment[]> {
  if (shareIds.length === 0) return []
  return await tx<ShareInstallment[]>`
    select * from advance_share_installment
    where share_id in ${tx(shareIds)}
    order by share_id, position
  `
}

/** The plan is restated whole: a promise is renegotiated, never patched line by line. */
export async function replaceInstallments(
  tx: Executor,
  shareId: string,
  lines: { dueOn: string; amount: number }[],
): Promise<void> {
  await tx`delete from advance_share_installment where share_id = ${shareId}`
  if (lines.length === 0) return
  await tx`
    insert into advance_share_installment ${tx(
      lines.map((line, index) => ({ shareId, position: index + 1, dueOn: line.dueOn, amount: line.amount })),
    )}
  `
}

/**
 * Repoints the shares owed by one actor to another, for a merge. Refused by
 * the caller when both owe on the same object: the unique index would reject
 * it here, and summing two shares that carry their own refunds and plans is a
 * decision, not a side effect of a merge.
 */
export async function sharedObjects(tx: Executor, fromActorId: string, toActorId: string): Promise<number> {
  const [row] = await tx<{ count: number }[]>`
    select count(*)::int as count
    from advance_share a
    join advance_share b
      on b.debtor_actor_id = ${toActorId}
     and (b.movement_id = a.movement_id or b.commitment_id = a.commitment_id)
    where a.debtor_actor_id = ${fromActorId}
  `
  return row!.count
}
