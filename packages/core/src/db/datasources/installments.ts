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
  amount: number,
): Promise<void> {
  // The confirmed amount replaces the planned one: what actually left the
  // account is the truth, and the remaining due derives from these rows.
  await tx`
    update financing_installment
    set movement_id = ${movementId}, amount = ${amount}, updated_at = now()
    where id = ${id}
  `
}

/**
 * Realigns a financing's cursor on its first unpaid installment. Needed after
 * a settling movement is deleted: the FK frees the installment on its own, but
 * next_due_on would stay ahead of it and the plan would look further along than
 * it is.
 */
export async function realignNextDue(tx: Executor, commitmentId: string): Promise<void> {
  await tx`
    update commitment c
    set next_due_on = coalesce(
      (
        select min(i.due_on) from financing_installment i
        where i.commitment_id = c.id and i.movement_id is null
      ),
      c.next_due_on
    ),
    updated_at = now()
    where c.id = ${commitmentId}
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
