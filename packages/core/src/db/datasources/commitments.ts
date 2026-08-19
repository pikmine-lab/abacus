import type { Commitment, CommitmentEvent, CommitmentEventType } from '../../domain/types.ts'
import { compact, type Executor } from '../client.ts'

export interface NewCommitment {
  userId: string
  kind: Commitment['kind']
  direction?: Commitment['direction']
  label: string
  actorId: string
  accountId: string
  categoryId?: string | null
  activityId?: string | null
  amount: number
  currency?: string
  periodUnit: Commitment['periodUnit']
  periodCount?: number
  nextDueOn: string
  judgment?: Commitment['judgment']
  judgmentNote?: string | null
  engagedUntil?: string | null
  installmentsTotal?: number | null
  totalAmount?: number | null
}

export async function insertCommitment(tx: Executor, row: NewCommitment): Promise<Commitment> {
  const [commitment] = await tx<Commitment[]>`insert into commitment ${tx(compact(row))} returning *`
  return commitment!
}

export async function getCommitment(tx: Executor, userId: string, id: string): Promise<Commitment | undefined> {
  const [commitment] = await tx<Commitment[]>`select * from commitment where user_id = ${userId} and id = ${id}`
  return commitment
}

/** Same row, locked against a concurrent confirm/skip until the transaction ends. */
export async function getCommitmentForUpdate(
  tx: Executor,
  userId: string,
  id: string,
): Promise<Commitment | undefined> {
  const [commitment] = await tx<Commitment[]>`
    select * from commitment where user_id = ${userId} and id = ${id} for update
  `
  return commitment
}

export async function listCommitments(
  tx: Executor,
  userId: string,
  opts: { activeOnly?: boolean; dueOnOrBefore?: string } = {},
): Promise<Commitment[]> {
  return await tx<Commitment[]>`
    select * from commitment
    where user_id = ${userId}
    ${opts.activeOnly ? tx`and cancelled_on is null` : tx``}
    ${opts.dueOnOrBefore ? tx`and next_due_on <= ${opts.dueOnOrBefore}` : tx``}
    order by next_due_on
  `
}

export async function updateCommitment(
  tx: Executor,
  userId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<Commitment | undefined> {
  const [commitment] = await tx<Commitment[]>`
    update commitment set ${tx({ ...patch, updatedAt: new Date() })}
    where user_id = ${userId} and id = ${id}
    returning *
  `
  return commitment
}

export async function insertCommitmentEvent(
  tx: Executor,
  commitmentId: string,
  occurredOn: string,
  type: CommitmentEventType,
  amount?: number | null,
  note?: string | null,
): Promise<CommitmentEvent> {
  const [event] = await tx<CommitmentEvent[]>`
    insert into commitment_event (commitment_id, occurred_on, type, amount, note)
    values (${commitmentId}, ${occurredOn}, ${type}, ${amount ?? null}, ${note ?? null})
    returning *
  `
  return event!
}

export async function listCommitmentEvents(tx: Executor, commitmentId: string): Promise<CommitmentEvent[]> {
  return await tx<CommitmentEvent[]>`
    select * from commitment_event where commitment_id = ${commitmentId} order by occurred_on, created_at
  `
}
