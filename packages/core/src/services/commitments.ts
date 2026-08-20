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
import {
  dueInstallments,
  insertInstallments,
  listInstallments,
  nextPendingInstallment,
  scheduleProgress,
  settleInstallment,
} from '../db/datasources/installments.ts'
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

/** One line of a payment plan, exactly as the contract states it. */
export interface InstallmentInput {
  dueOn: string
  amount: number
}

export interface FinancingInput {
  label: string
  actorId: string
  accountId: string
  categoryId?: string
  activityId?: string
  installmentsTotal: number
  /**
   * What is owed in total. The default schedule is built from it: equal
   * amounts, the rounding cent landing on the last one, one period apart.
   */
  totalAmount?: number
  /**
   * The plan spelled out, when it is not N equal amounts on the same day: a
   * prorated first month, a date pushed off a weekend, uneven thirds. It
   * replaces the generated schedule and its sum must match the total.
   */
  installments?: InstallmentInput[]
  periodUnit?: PeriodUnit
  periodCount?: number
  firstDueOn: string
}

/**
 * The default plan: equal installments one period apart, the rounding
 * difference carried by the last one so the schedule always sums to the total
 * exactly (1 000 € in 3 is 333,33 + 333,33 + 333,34, never 999,99).
 */
export function defaultSchedule(input: {
  totalAmount: number
  installmentsTotal: number
  firstDueOn: string
  periodUnit?: PeriodUnit
  periodCount?: number
}): InstallmentInput[] {
  const unit = input.periodUnit ?? 'month'
  const count = input.periodCount ?? 1
  const cents = Math.round(input.totalAmount * 100)
  const share = Math.floor(cents / input.installmentsTotal)
  let dueOn = input.firstDueOn
  const schedule: InstallmentInput[] = []
  for (let position = 1; position <= input.installmentsTotal; position++) {
    const isLast = position === input.installmentsTotal
    const amount = isLast ? cents - share * (input.installmentsTotal - 1) : share
    schedule.push({ dueOn, amount: amount / 100 })
    dueOn = addPeriod(dueOn, unit, count)
  }
  return schedule
}

/**
 * A payment plan is stated as a total over N installments, so that is what is
 * asked, and the schedule it implies is written down: equal amounts one period
 * apart. A caller who knows better passes the plan line by line instead:
 * an uneven split, a prorated first month, a date pushed off a weekend.
 *
 * Either way the schedule must add up to the total, and it becomes the source
 * of truth: the remaining due is the sum of what is still owed, never a
 * subtraction that rounding could bend.
 */
export async function createFinancing(userId: string, input: FinancingInput): Promise<Commitment> {
  const sql = db()
  return await sql.begin(async (tx) => {
    await requireRefs(tx, userId, input.actorId, input.accountId)
    if (input.totalAmount === undefined && input.installments === undefined)
      throw new DomainError('financing_needs_amount', 'A financing needs a total amount or a schedule')

    const schedule =
      input.installments ??
      defaultSchedule({
        totalAmount: input.totalAmount!,
        installmentsTotal: input.installmentsTotal,
        firstDueOn: input.firstDueOn,
        periodUnit: input.periodUnit,
        periodCount: input.periodCount,
      })

    if (schedule.length !== input.installmentsTotal)
      throw new DomainError(
        'schedule_length_mismatch',
        `The schedule has ${schedule.length} installments but the plan says ${input.installmentsTotal}`,
      )

    const scheduled = schedule.reduce((sum, line) => sum + Math.round(line.amount * 100), 0)
    const total = input.totalAmount !== undefined ? Math.round(input.totalAmount * 100) : scheduled
    if (scheduled !== total)
      throw new DomainError(
        'schedule_sum_mismatch',
        `The installments add up to ${scheduled / 100} but the total is ${total / 100}`,
      )

    // The stored amount is the plan's nominal installment, used for "roughly x
    // per month"; each occurrence carries its own real amount.
    const installmentAmount = schedule[0]!.amount
    const commitment = await insertCommitment(tx, {
      userId,
      kind: 'financing',
      direction: 'outgoing',
      label: input.label,
      actorId: input.actorId,
      accountId: input.accountId,
      categoryId: input.categoryId ?? null,
      activityId: input.activityId ?? null,
      amount: installmentAmount,
      periodUnit: input.periodUnit ?? 'month',
      periodCount: input.periodCount ?? 1,
      nextDueOn: schedule[0]!.dueOn,
      installmentsTotal: input.installmentsTotal,
      totalAmount: total / 100,
    })
    await insertInstallments(
      tx,
      commitment.id,
      schedule.map((line, index) => ({ position: index + 1, dueOn: line.dueOn, amount: line.amount })),
    )
    await insertCommitmentEvent(tx, commitment.id, today(), 'created', installmentAmount)
    return commitment
  })
}

export async function listCommitments(userId: string, activeOnly = true): Promise<Commitment[]> {
  return await listCommitmentsDs(db(), userId, { activeOnly })
}

export interface FinancingProgress {
  paidInstallments: number
  paidTotal: string
  /** Sum of the installments still owed, so an adjusted plan stays exact. */
  remainingDue: number
  /** Amount of the next installment, which may differ from the others. */
  nextAmount: number | null
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
      const progress = await scheduleProgress(sql, c.id)
      if (!progress) return { ...c, progress: null }
      return {
        ...c,
        progress: {
          paidInstallments: progress.paid,
          paidTotal: progress.paidAmount,
          remainingDue: Number(progress.remainingDue),
          nextAmount: progress.nextAmount === null ? null : Number(progress.nextAmount),
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
    await insertCommitmentEvent(
      tx,
      id,
      today(),
      'judgment_changed',
      null,
      `${judgment}${note ? `: ${note}` : ''}`,
    )
    return updated!
  })
}

export async function cancelCommitment(userId: string, id: string, on?: string): Promise<Commitment> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const commitment = await getCommitmentForUpdate(tx, userId, id)
    if (!commitment) throw new DomainError('commitment_not_found', `No commitment ${id} for this user`)
    if (commitment.cancelledOn)
      throw new DomainError('already_cancelled', 'This commitment is already cancelled')
    const cancelledOn = on ?? today()
    const updated = await updateCommitment(tx, userId, id, { cancelledOn })
    await insertCommitmentEvent(tx, id, cancelledOn, 'cancelled')
    return updated!
  })
}

/** What one period of a commitment costs per month, for "committed monthly cost" views. */
export function monthlyEquivalent(c: Pick<Commitment, 'amount' | 'periodUnit' | 'periodCount'>): number {
  const amount = Number(c.amount)
  const perMonth =
    c.periodUnit === 'month'
      ? 1 / c.periodCount
      : c.periodUnit === 'year'
        ? 1 / (12 * c.periodCount)
        : 52 / (12 * c.periodCount)
  return Math.round(amount * perMonth * 100) / 100
}

export interface PendingOccurrence {
  commitment: Commitment
  dueOn: string
  /**
   * What this occurrence is expected to be. It is the commitment's amount for a
   * subscription, and the scheduled installment for a financing, which is the
   * point of storing a schedule: the third installment may differ from the
   * first.
   */
  amount: number
}

/**
 * Expected occurrences up to a date, oldest first.
 *
 * A subscription is open-ended, so its occurrences are expanded from
 * next_due_on. A financing has a written schedule, so its own rows are read:
 * that is the only way an uneven plan can be confirmed for what it is.
 */
export async function pendingOccurrences(userId: string, until?: string): Promise<PendingOccurrence[]> {
  const sql = db()
  const limit = until ?? today()
  const due = await listCommitmentsDs(sql, userId, { activeOnly: true, dueOnOrBefore: limit })
  const pending: PendingOccurrence[] = []
  for (const commitment of due) {
    if (commitment.kind === 'financing') {
      for (const installment of await dueInstallments(sql, commitment.id, limit))
        pending.push({ commitment, dueOn: installment.dueOn, amount: Number(installment.amount) })
      continue
    }
    let dueOn = commitment.nextDueOn
    while (dueOn <= limit) {
      pending.push({ commitment, dueOn, amount: Number(commitment.amount) })
      dueOn = addPeriod(dueOn, commitment.periodUnit, commitment.periodCount)
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
 *
 * `updateReference` says the divergence is not a one-off: the commitment's
 * amount becomes the confirmed one and a dated price_changed event records it.
 * A salary moves for a month (a short month, a bonus) or for good (a raise),
 * and only the person confirming knows which, so it is asked, not guessed.
 * Both writes share this transaction: a recorded raise without its movement,
 * or the reverse, would be worse than either.
 */
export async function confirmNextOccurrence(
  userId: string,
  id: string,
  overrides: { amount?: number; happenedOn?: string; updateReference?: boolean } = {},
): Promise<Movement> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const commitment = await getCommitmentForUpdate(tx, userId, id)
    if (!commitment) throw new DomainError('commitment_not_found', `No commitment ${id} for this user`)
    if (commitment.cancelledOn) throw new DomainError('cancelled', 'This commitment is cancelled')
    // A financing settles the next line of its written schedule, which carries
    // its own date and amount; a subscription has no schedule to consume.
    const installment =
      commitment.kind === 'financing' ? await nextPendingInstallment(tx, commitment.id) : undefined
    if (commitment.kind === 'financing' && !installment)
      throw new DomainError('financing_settled', 'Every installment of this financing is already paid')

    const expected = installment ? Number(installment.amount) : Number(commitment.amount)
    const outgoing = commitment.direction === 'outgoing'
    const movement = await declareMovementIn(tx, userId, {
      happenedOn: overrides.happenedOn ?? installment?.dueOn ?? commitment.nextDueOn,
      amount: overrides.amount ?? expected,
      sourceAccountId: outgoing ? commitment.accountId : undefined,
      targetActorId: outgoing ? commitment.actorId : undefined,
      sourceActorId: outgoing ? undefined : commitment.actorId,
      targetAccountId: outgoing ? undefined : commitment.accountId,
      categoryId: commitment.categoryId ?? undefined,
      activityId: commitment.activityId,
      commitmentId: commitment.id,
    })
    const confirmedAmount = overrides.amount ?? expected

    if (installment) {
      // The schedule records what was really paid, so the remaining due: the
      // sum of the unpaid lines: stays exact without recomputing anything.
      await settleInstallment(tx, installment.id, movement.id, confirmedAmount)
      const next = await nextPendingInstallment(tx, commitment.id)
      await updateCommitment(tx, userId, id, { nextDueOn: next?.dueOn ?? installment.dueOn })
      return movement
    }

    const becomesTheNorm = overrides.updateReference === true && confirmedAmount !== Number(commitment.amount)
    await updateCommitment(tx, userId, id, {
      nextDueOn: addPeriod(commitment.nextDueOn, commitment.periodUnit, commitment.periodCount),
      ...(becomesTheNorm ? { amount: confirmedAmount } : {}),
    })
    if (becomesTheNorm)
      await insertCommitmentEvent(tx, id, movement.happenedOn, 'price_changed', confirmedAmount)
    return movement
  })
}

/**
 * Advances past an occurrence that will not happen (paused service, free
 * month). On a financing this is refused: a written plan does not lose an
 * installment silently, either it was paid (confirm) or the plan changed,
 * which is a different, explicit act.
 */
export async function skipNextOccurrence(userId: string, id: string): Promise<Commitment> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const commitment = await getCommitmentForUpdate(tx, userId, id)
    if (!commitment) throw new DomainError('commitment_not_found', `No commitment ${id} for this user`)
    if (commitment.cancelledOn) throw new DomainError('cancelled', 'This commitment is cancelled')
    if (commitment.kind === 'financing')
      throw new DomainError(
        'cannot_skip_financing',
        'A financing installment is owed: confirm it, or close the financing',
      )
    const updated = await updateCommitment(tx, userId, id, {
      nextDueOn: addPeriod(commitment.nextDueOn, commitment.periodUnit, commitment.periodCount),
    })
    return updated!
  })
}

/** The written plan of a financing, in contractual order. */
export async function financingSchedule(userId: string, id: string) {
  const sql = db()
  const commitment = await getCommitment(sql, userId, id)
  if (!commitment) throw new DomainError('commitment_not_found', `No commitment ${id} for this user`)
  return await listInstallments(sql, id)
}
