import { db, type Executor } from '../db/client.ts'
import { getAccount } from '../db/datasources/accounts.ts'
import { getActor } from '../db/datasources/actors.ts'
import {
  getCommitment,
  getCommitmentForUpdate,
  insertCommitment,
  insertCommitmentEvent,
  listCommitmentEvents,
  listCommitments as listCommitmentsDs,
  updateCommitment,
} from '../db/datasources/commitments.ts'
import { countMovementsForCommitment, sumMovementsForCommitment } from '../db/datasources/movements.ts'
import { DomainError } from '../domain/errors.ts'
import { addPeriod, today } from '../domain/period.ts'
import type { Commitment, CommitmentEvent, Judgment, Movement, PeriodUnit } from '../domain/types.ts'
import { declareMovementIn } from './movements.ts'

async function requireRefs(tx: Executor, userId: string, actorId: string, accountId: string): Promise<void> {
  if (!(await getActor(tx, userId, actorId)))
    throw new DomainError('actor_not_found', `No actor ${actorId} for this user`)
  if (!(await getAccount(tx, userId, accountId)))
    throw new DomainError('account_not_found', `No account ${accountId} for this user`)
}

export interface SubscriptionInput {
  label: string
  actorId: string
  accountId: string
  direction?: 'outgoing' | 'incoming'
  categoryId?: string
  activityId?: string
  amount: number
  periodUnit: PeriodUnit
  periodCount?: number
  firstDueOn: string
  judgment?: Judgment
  judgmentNote?: string
  engagedUntil?: string
}

export async function createSubscription(userId: string, input: SubscriptionInput): Promise<Commitment> {
  const sql = db()
  return await sql.begin(async (tx) => {
    await requireRefs(tx, userId, input.actorId, input.accountId)
    const commitment = await insertCommitment(tx, {
      userId,
      kind: 'subscription',
      direction: input.direction ?? 'outgoing',
      label: input.label,
      actorId: input.actorId,
      accountId: input.accountId,
      categoryId: input.categoryId ?? null,
      activityId: input.activityId ?? null,
      amount: input.amount,
      periodUnit: input.periodUnit,
      periodCount: input.periodCount ?? 1,
      nextDueOn: input.firstDueOn,
      judgment: input.judgment ?? null,
      judgmentNote: input.judgmentNote ?? null,
      engagedUntil: input.engagedUntil ?? null,
    })
    await insertCommitmentEvent(tx, commitment.id, today(), 'created', input.amount)
    return commitment
  })
}

export interface FinancingInput {
  label: string
  actorId: string
  accountId: string
  categoryId?: string
  activityId?: string
  installmentAmount: number
  installmentsTotal: number
  /** Defaults to installmentAmount x installmentsTotal; set it when fees make it differ. */
  totalAmount?: number
  periodUnit?: PeriodUnit
  periodCount?: number
  firstDueOn: string
}

export async function createFinancing(userId: string, input: FinancingInput): Promise<Commitment> {
  const sql = db()
  return await sql.begin(async (tx) => {
    await requireRefs(tx, userId, input.actorId, input.accountId)
    const total = input.totalAmount ?? Math.round(input.installmentAmount * input.installmentsTotal * 100) / 100
    const commitment = await insertCommitment(tx, {
      userId,
      kind: 'financing',
      direction: 'outgoing',
      label: input.label,
      actorId: input.actorId,
      accountId: input.accountId,
      categoryId: input.categoryId ?? null,
      activityId: input.activityId ?? null,
      amount: input.installmentAmount,
      periodUnit: input.periodUnit ?? 'month',
      periodCount: input.periodCount ?? 1,
      nextDueOn: input.firstDueOn,
      installmentsTotal: input.installmentsTotal,
      totalAmount: total,
    })
    await insertCommitmentEvent(tx, commitment.id, today(), 'created', input.installmentAmount)
    return commitment
  })
}

export async function listCommitments(userId: string, activeOnly = true): Promise<Commitment[]> {
  return await listCommitmentsDs(db(), userId, { activeOnly })
}

export interface FinancingProgress {
  paidInstallments: number
  paidTotal: string
  /** total_amount minus what was actually paid. */
  remainingDue: number
}

/** Commitments plus, for financings, the derived progress (paid, remaining due). */
export async function listCommitmentsWithProgress(
  userId: string,
  activeOnly = true,
): Promise<(Commitment & { progress: FinancingProgress | null })[]> {
  const sql = db()
  const commitments = await listCommitmentsDs(sql, userId, { activeOnly })
  return await Promise.all(
    commitments.map(async (c) => {
      if (c.kind !== 'financing') return { ...c, progress: null }
      const paidInstallments = await countMovementsForCommitment(sql, c.id)
      const paidTotal = await sumMovementsForCommitment(sql, c.id)
      return {
        ...c,
        progress: {
          paidInstallments,
          paidTotal,
          remainingDue: Math.round((Number(c.totalAmount) - Number(paidTotal)) * 100) / 100,
        },
      }
    }),
  )
}

export async function commitmentEvents(userId: string, id: string): Promise<CommitmentEvent[]> {
  const sql = db()
  const commitment = await getCommitment(sql, userId, id)
  if (!commitment) throw new DomainError('commitment_not_found', `No commitment ${id} for this user`)
  return await listCommitmentEvents(sql, id)
}

export async function changeAmount(
  userId: string,
  id: string,
  newAmount: number,
  effectiveOn?: string,
): Promise<Commitment> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const commitment = await getCommitmentForUpdate(tx, userId, id)
    if (!commitment) throw new DomainError('commitment_not_found', `No commitment ${id} for this user`)
    const updated = await updateCommitment(tx, userId, id, { amount: newAmount })
    await insertCommitmentEvent(tx, id, effectiveOn ?? today(), 'price_changed', newAmount)
    return updated!
  })
}

export async function setJudgment(
  userId: string,
  id: string,
  judgment: Judgment,
  note?: string,
): Promise<Commitment> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const commitment = await getCommitmentForUpdate(tx, userId, id)
    if (!commitment) throw new DomainError('commitment_not_found', `No commitment ${id} for this user`)
    if (commitment.kind !== 'subscription')
      throw new DomainError('not_a_subscription', 'Only subscriptions carry a judgment')
    const updated = await updateCommitment(tx, userId, id, { judgment, judgmentNote: note ?? null })
    await insertCommitmentEvent(tx, id, today(), 'judgment_changed', null, `${judgment}${note ? `: ${note}` : ''}`)
    return updated!
  })
}

export async function cancelCommitment(userId: string, id: string, on?: string): Promise<Commitment> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const commitment = await getCommitmentForUpdate(tx, userId, id)
    if (!commitment) throw new DomainError('commitment_not_found', `No commitment ${id} for this user`)
    if (commitment.cancelledOn) throw new DomainError('already_cancelled', 'This commitment is already cancelled')
    const cancelledOn = on ?? today()
    const updated = await updateCommitment(tx, userId, id, { cancelledOn })
    await insertCommitmentEvent(tx, id, cancelledOn, 'cancelled')
    return updated!
  })
}

export interface PendingOccurrence {
  commitment: Commitment
  dueOn: string
}

/**
 * Expected occurrences up to a date, oldest first. Nothing is materialized:
 * this expands each active commitment from its next_due_on, and financings
 * stop at their last installment.
 */
export async function pendingOccurrences(userId: string, until?: string): Promise<PendingOccurrence[]> {
  const sql = db()
  const limit = until ?? today()
  const due = await listCommitmentsDs(sql, userId, { activeOnly: true, dueOnOrBefore: limit })
  const pending: PendingOccurrence[] = []
  for (const commitment of due) {
    let remaining = Number.POSITIVE_INFINITY
    if (commitment.kind === 'financing') {
      const paid = await countMovementsForCommitment(sql, commitment.id)
      remaining = commitment.installmentsTotal! - paid
    }
    let dueOn = commitment.nextDueOn
    while (dueOn <= limit && remaining > 0) {
      pending.push({ commitment, dueOn })
      dueOn = addPeriod(dueOn, commitment.periodUnit, commitment.periodCount)
      remaining -= 1
    }
  }
  pending.sort((a, b) => a.dueOn.localeCompare(b.dueOn))
  return pending
}

/**
 * Turns the next expected occurrence into a real movement and advances the
 * commitment, in one transaction. Amount and date can be overridden when
 * reality differed (that divergence is how silent price bumps get noticed,
 * but recording the truth always wins).
 */
export async function confirmNextOccurrence(
  userId: string,
  id: string,
  overrides: { amount?: number; happenedOn?: string } = {},
): Promise<Movement> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const commitment = await getCommitmentForUpdate(tx, userId, id)
    if (!commitment) throw new DomainError('commitment_not_found', `No commitment ${id} for this user`)
    if (commitment.cancelledOn) throw new DomainError('cancelled', 'This commitment is cancelled')
    if (commitment.kind === 'financing') {
      const paid = await countMovementsForCommitment(tx, commitment.id)
      if (paid >= commitment.installmentsTotal!)
        throw new DomainError('financing_settled', 'Every installment of this financing is already paid')
    }
    const outgoing = commitment.direction === 'outgoing'
    const movement = await declareMovementIn(tx, userId, {
      happenedOn: overrides.happenedOn ?? commitment.nextDueOn,
      amount: overrides.amount ?? Number(commitment.amount),
      sourceAccountId: outgoing ? commitment.accountId : undefined,
      targetActorId: outgoing ? commitment.actorId : undefined,
      sourceActorId: outgoing ? undefined : commitment.actorId,
      targetAccountId: outgoing ? undefined : commitment.accountId,
      categoryId: commitment.categoryId ?? undefined,
      activityId: commitment.activityId,
      commitmentId: commitment.id,
    })
    await updateCommitment(tx, userId, id, {
      nextDueOn: addPeriod(commitment.nextDueOn, commitment.periodUnit, commitment.periodCount),
    })
    return movement
  })
}

/** Advances past an occurrence that will not happen (paused service, free month). */
export async function skipNextOccurrence(userId: string, id: string): Promise<Commitment> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const commitment = await getCommitmentForUpdate(tx, userId, id)
    if (!commitment) throw new DomainError('commitment_not_found', `No commitment ${id} for this user`)
    if (commitment.cancelledOn) throw new DomainError('cancelled', 'This commitment is cancelled')
    const updated = await updateCommitment(tx, userId, id, {
      nextDueOn: addPeriod(commitment.nextDueOn, commitment.periodUnit, commitment.periodCount),
    })
    return updated!
  })
}
