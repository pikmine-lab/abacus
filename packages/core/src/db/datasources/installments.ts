import type { Executor } from '../client.ts'

/**
 * One installment of a financing plan. The schedule is stored rather than
 * derived, because a real plan is rarely N equal amounts on the same day.
 */
export interface FinancingInstallment {
  id: string
  commitmentId: string
  position: number
  dueOn: string
  amount: string
  movementId: string | null
}

export interface NewInstallment {
  position: number
  dueOn: string
  amount: number
}

export async function insertInstallments(
  tx: Executor,
  commitmentId: string,
  rows: NewInstallment[],
): Promise<void> {
  if (rows.length === 0) return
  await tx`
    insert into financing_installment ${tx(
      rows.map((row) => ({
        commitmentId,
        position: row.position,
        dueOn: row.dueOn,
        amount: row.amount,
      })),
    )}
  `
}

export async function listInstallments(tx: Executor, commitmentId: string): Promise<FinancingInstallment[]> {
  return await tx<FinancingInstallment[]>`
    select * from financing_installment
    where commitment_id = ${commitmentId}
    order by position
  `
}

/** Same rows, locked so a concurrent confirmation cannot settle one mid-revision. */
export async function listInstallmentsForUpdate(
  tx: Executor,
  commitmentId: string,
): Promise<FinancingInstallment[]> {
  return await tx<FinancingInstallment[]>`
    select * from financing_installment
    where commitment_id = ${commitmentId}
    order by position
    for update
  `
}

/** The installment a movement settled, if it settled one. */
export async function installmentByMovement(
  tx: Executor,
  movementId: string,
): Promise<FinancingInstallment | undefined> {
  const [installment] = await tx<FinancingInstallment[]>`
    select * from financing_installment where movement_id = ${movementId} for update
  `
  return installment
}

/**
 * Frees the positions of a whole plan before it is renumbered: the
 * (commitment, position) unique index is checked row by row, so line 2 cannot
 * become line 1 while line 1 still holds it.
 */
export async function shiftPositions(tx: Executor, commitmentId: string, offset: number): Promise<void> {
  await tx`
    update financing_installment
    set position = position + ${offset}
    where commitment_id = ${commitmentId}
  `
}

export async function updateInstallmentPlan(
  tx: Executor,
  id: string,
  plan: { position: number; dueOn: string; amount: number },
): Promise<void> {
  await tx`
    update financing_installment
    set position = ${plan.position}, due_on = ${plan.dueOn}, amount = ${plan.amount}, updated_at = now()
    where id = ${id}
  `
}

export async function deleteInstallments(tx: Executor, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await tx`delete from financing_installment where id in ${tx(ids)}`
}

/** Realigns a settled installment on what its movement really says. */
export async function alignInstallmentOnMovement(
  tx: Executor,
  id: string,
  payment: { amount: number; on: string },
): Promise<void> {
  await tx`
    update financing_installment
    set amount = ${payment.amount}, due_on = ${payment.on}, updated_at = now()
    where id = ${id}
  `
}

/**
 * The next installment still owed, by contractual order. Locked for update so
 * two confirmations racing cannot settle the same one twice.
 */
export async function nextPendingInstallment(
  tx: Executor,
  commitmentId: string,
): Promise<FinancingInstallment | undefined> {
  const [installment] = await tx<FinancingInstallment[]>`
    select * from financing_installment
    where commitment_id = ${commitmentId} and movement_id is null
    order by position
    limit 1
    for update
  `
  return installment
}

/** Installments whose date has come and that are still unpaid, oldest first. */
export async function dueInstallments(
  tx: Executor,
  commitmentId: string,
  onOrBefore: string,
): Promise<FinancingInstallment[]> {
  return await tx<FinancingInstallment[]>`
    select * from financing_installment
    where commitment_id = ${commitmentId}
      and movement_id is null
      and due_on <= ${onOrBefore}
    order by position
  `
}

export async function settleInstallment(
  tx: Executor,
  id: string,
  movementId: string,
  payment: { amount: number; on: string },
): Promise<void> {
  // The payment replaces the plan on that row: what actually left the account,
  // the day it left. A settled installment states the payment, not the
  // intention, and the remaining due derives from these rows.
  await tx`
    update financing_installment
    set movement_id = ${movementId},
        amount = ${payment.amount},
        due_on = ${payment.on},
        updated_at = now()
    where id = ${id}
  `
}

/**
 * Rewrites everything a financing derives from its own schedule: how many
 * installments it has, what it owes in total, the nominal amount of one, and
 * the date it is next due. Every write on the schedule ends here: a revised
 * plan, a corrected settling movement and a deleted one all leave the same
 * truth behind, instead of each patching its own corner.
 *
 * A settled plan keeps its last known cursor and nominal amount: there is no
 * next installment to read them from, and both columns are non-null.
 */
export async function resyncFinancing(tx: Executor, commitmentId: string): Promise<void> {
  await tx`
    update commitment c
    set installments_total = s.total,
        total_amount = s.owed,
        amount = coalesce(s.next_amount, c.amount),
        next_due_on = coalesce(s.next_due_on, c.next_due_on),
        updated_at = now()
    from (
      select
        count(*)::int as total,
        sum(amount)::numeric(12,2) as owed,
        min(due_on) filter (where movement_id is null) as next_due_on,
        (
          select amount from financing_installment n
          where n.commitment_id = ${commitmentId} and n.movement_id is null
          order by n.position limit 1
        ) as next_amount
      from financing_installment
      where commitment_id = ${commitmentId}
    ) s
    where c.id = ${commitmentId} and c.kind = 'financing' and s.total > 0
  `
}

export interface ScheduleProgress {
  paid: number
  total: number
  paidAmount: string
  remainingDue: string
  /** Date of the next unpaid installment, null once the plan is settled. */
  nextDueOn: string | null
  /** Amount of the next unpaid installment, null once settled. */
  nextAmount: string | null
}

/**
 * Progress of a plan, from its own rows: the remaining due is the sum of what
 * is still owed, never "total minus paid", so an adjusted schedule stays exact.
 */
export async function scheduleProgress(
  tx: Executor,
  commitmentId: string,
): Promise<ScheduleProgress | undefined> {
  const [row] = await tx<ScheduleProgress[]>`
    select
      count(*) filter (where movement_id is not null)::int as paid,
      count(*)::int as total,
      coalesce(sum(amount) filter (where movement_id is not null), 0)::numeric(14,2) as paid_amount,
      coalesce(sum(amount) filter (where movement_id is null), 0)::numeric(14,2) as remaining_due,
      min(due_on) filter (where movement_id is null) as next_due_on,
      (
        select amount from financing_installment n
        where n.commitment_id = ${commitmentId} and n.movement_id is null
        order by n.position limit 1
      ) as next_amount
    from financing_installment
    where commitment_id = ${commitmentId}
  `
  return row?.total ? row : undefined
}
