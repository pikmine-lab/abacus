import { db, type Executor } from '../db/client.ts'
import { getAccount } from '../db/datasources/accounts.ts'
import { getActor } from '../db/datasources/actors.ts'
import {
  type AccountPeriod,
  accountTimeline,
  getCommitment,
  getCommitmentForUpdate,
  insertCommitment,
  insertCommitmentEvent,
  listCommitmentEvents,
  listCommitments as listCommitmentsDs,
  updateCommitment,
} from '../db/datasources/commitments.ts'
import {
  deleteInstallments,
  dueInstallments,
  insertInstallments,
  listInstallments,
  listInstallmentsForUpdate,
  type NewInstallment,
  nextPendingInstallment,
  resyncFinancing,
  scheduleProgress,
  settleInstallment,
  shiftPositions,
  updateInstallmentPlan,
} from '../db/datasources/installments.ts'
import { DomainError } from '../domain/errors.ts'
import { addPeriod, today } from '../domain/period.ts'
import type { Commitment, CommitmentEvent, Judgment, Movement, PeriodUnit } from '../domain/types.ts'
import { fetchHistory, type HistoryFetcher } from '../prices/sources.ts'
import { eurRateLatest, eurRateOn, toEur } from './fx.ts'
import { correctMovementIn, declareMovementIn, deleteMovementIn } from './movements.ts'

/**
 * The currency a commitment bills in, resolved at declaration. A foreign one
 * is asked for its rate right away: that validates the code and backfills the
 * pair, so the forecasts (committed monthly cost) can convert without waiting
 * for a first occurrence.
 */
async function resolveCurrency(
  tx: Executor,
  currency: string | undefined,
  history: HistoryFetcher,
): Promise<string> {
  const code = (currency ?? 'EUR').toUpperCase()
  if (code !== 'EUR') await eurRateOn(tx, code, today(), history)
  return code
}

async function requireActor(tx: Executor, userId: string, actorId: string): Promise<void> {
  if (!(await getActor(tx, userId, actorId)))
    throw new DomainError('actor_not_found', `No actor ${actorId} for this user`)
}

async function requireAccount(tx: Executor, userId: string, accountId: string): Promise<void> {
  if (!(await getAccount(tx, userId, accountId)))
    throw new DomainError('account_not_found', `No account ${accountId} for this user`)
}

async function requireRefs(tx: Executor, userId: string, actorId: string, accountId: string): Promise<void> {
  await requireActor(tx, userId, actorId)
  await requireAccount(tx, userId, accountId)
}

/**
 * The account in force on a date. The timeline starts with the account the
 * commitment was declared on, so there is always one to fall back to.
 */
function accountAt(timeline: AccountPeriod[], on: string): string {
  let accountId = timeline[0]!.accountId
  for (const period of timeline) if (period.since !== null && period.since <= on) accountId = period.accountId
  return accountId
}

export interface SubscriptionInput {
  label: string
  actorId: string
  accountId: string
  direction?: 'outgoing' | 'incoming'
  categoryId?: string
  activityId?: string
  amount: number
  /** ISO 4217 code the commitment bills in; each occurrence converts like any movement. */
  currency?: string
  periodUnit: PeriodUnit
  periodCount?: number
  firstDueOn: string
  judgment?: Judgment
  judgmentNote?: string
  engagedUntil?: string
}

export async function createSubscription(
  userId: string,
  input: SubscriptionInput,
  history: HistoryFetcher = fetchHistory,
): Promise<Commitment> {
  const sql = db()
  return await sql.begin(async (tx) => {
    await requireRefs(tx, userId, input.actorId, input.accountId)
    const currency = await resolveCurrency(tx, input.currency, history)
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
      currency,
      periodUnit: input.periodUnit,
      periodCount: input.periodCount ?? 1,
      nextDueOn: input.firstDueOn,
      judgment: input.judgment ?? null,
      judgmentNote: input.judgmentNote ?? null,
      engagedUntil: input.engagedUntil ?? null,
    })
    await insertCommitmentEvent(tx, commitment.id, today(), 'created', input.amount, null, null, currency)
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
  /** ISO 4217 code the whole plan is written in: total, installments, nominal. */
  currency?: string
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
export async function createFinancing(
  userId: string,
  input: FinancingInput,
  history: HistoryFetcher = fetchHistory,
): Promise<Commitment> {
  const sql = db()
  return await sql.begin(async (tx) => {
    await requireRefs(tx, userId, input.actorId, input.accountId)
    const currency = await resolveCurrency(tx, input.currency, history)
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
      currency,
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
    await insertCommitmentEvent(
      tx,
      commitment.id,
      today(),
      'created',
      installmentAmount,
      null,
      null,
      currency,
    )
    return commitment
  })
}

/**
 * A commitment with its amount re-said in euros at the latest known rate.
 * `amount` stays in the billing currency (it is what the provider states);
 * `amountEur` is what forecast sums add up, equal to it on a EUR commitment
 * and null in the one case no rate was ever fetched for the pair.
 */
export type CommitmentWithEur = Commitment & { amountEur: string | null }

/** The latest known rate of every foreign currency these commitments bill in. */
async function latestRates(
  tx: Executor,
  commitments: Commitment[],
  history: HistoryFetcher,
): Promise<Map<string, string | null>> {
  const codes = [...new Set(commitments.map((c) => c.currency).filter((c) => c !== 'EUR'))]
  const rates = new Map<string, string | null>()
  for (const code of codes) rates.set(code, await eurRateLatest(tx, code, history))
  return rates
}

/** A stated amount re-said in euros at the latest rate; null when none is known. */
function eurOf(amount: string, currency: string, rates: Map<string, string | null>): string | null {
  if (currency === 'EUR') return amount
  const rate = rates.get(currency)
  return rate ? toEur(Number(amount), rate).toFixed(2) : null
}

async function withEurAmounts<T extends Commitment>(
  tx: Executor,
  commitments: T[],
  history: HistoryFetcher,
): Promise<(T & { amountEur: string | null })[]> {
  const rates = await latestRates(tx, commitments, history)
  return commitments.map((c) => ({ ...c, amountEur: eurOf(c.amount, c.currency, rates) }))
}

export async function listCommitments(
  userId: string,
  activeOnly = true,
  history: HistoryFetcher = fetchHistory,
): Promise<CommitmentWithEur[]> {
  const sql = db()
  return await withEurAmounts(sql, await listCommitmentsDs(sql, userId, { activeOnly }), history)
}

export interface FinancingProgress {
  paidInstallments: number
  paidTotal: string
  /** Sum of the installments still owed, in the plan's own currency. */
  remainingDue: number
  /** The same in euros at the latest rate: what a sum across plans adds up. */
  remainingDueEur: number | null
  /** Amount of the next installment, which may differ from the others. */
  nextAmount: number | null
}

/** Commitments plus, for financings, the derived progress (paid, remaining due). */
export async function listCommitmentsWithProgress(
  userId: string,
  activeOnly = true,
  history: HistoryFetcher = fetchHistory,
): Promise<(CommitmentWithEur & { progress: FinancingProgress | null })[]> {
  const sql = db()
  const raw = await listCommitmentsDs(sql, userId, { activeOnly })
  const rates = await latestRates(sql, raw, history)
  return await Promise.all(
    raw.map(async (c) => {
      const amountEur = eurOf(c.amount, c.currency, rates)
      if (c.kind !== 'financing') return { ...c, amountEur, progress: null }
      const progress = await scheduleProgress(sql, c.id)
      if (!progress) return { ...c, amountEur, progress: null }
      const remainingDueEur = eurOf(progress.remainingDue, c.currency, rates)
      return {
        ...c,
        amountEur,
        progress: {
          paidInstallments: progress.paid,
          paidTotal: progress.paidAmount,
          remainingDue: Number(progress.remainingDue),
          remainingDueEur: remainingDueEur === null ? null : Number(remainingDueEur),
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
  opts: { currency?: string; history?: HistoryFetcher } = {},
): Promise<Commitment> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const commitment = await getCommitmentForUpdate(tx, userId, id)
    if (!commitment) throw new DomainError('commitment_not_found', `No commitment ${id} for this user`)
    // The billing currency moves with the price and nothing else: it is what
    // the new amount is stated in, and past events keep the currency of their
    // own day. A financing's plan is written in its currency, so it stays.
    // Unchanged, it is already validated and backfilled: a plain price change
    // must not depend on the network.
    const requested = (opts.currency ?? commitment.currency).toUpperCase()
    const currency =
      requested === commitment.currency
        ? requested
        : await resolveCurrency(tx, requested, opts.history ?? fetchHistory)
    if (currency !== commitment.currency && commitment.kind === 'financing')
      throw new DomainError(
        'financing_keeps_currency',
        'A financing schedule is written in its currency: it does not change mid-plan',
      )
    const updated = await updateCommitment(tx, userId, id, { amount: newAmount, currency })
    await insertCommitmentEvent(
      tx,
      id,
      effectiveOn ?? today(),
      'price_changed',
      newAmount,
      null,
      null,
      currency,
    )
    return updated!
  })
}

/**
 * Moves what a commitment hits to another account, from a date.
 *
 * A recurring payment that changes account is an event, not a typo, and the
 * date is the whole point. It is usually known before it takes effect ("from
 * next month it leaves the other account"), so it is declared the day it is
 * learnt instead of having to be remembered on the right day. And an occurrence
 * confirmed late lands on the account the money really left, not on the one in
 * force the day someone got round to confirming it.
 *
 * Movements already declared are untouched, here as everywhere: they state what
 * happened, on the account it happened on.
 */
export async function moveAccount(
  userId: string,
  id: string,
  accountId: string,
  effectiveOn?: string,
): Promise<Commitment> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const commitment = await getCommitmentForUpdate(tx, userId, id)
    if (!commitment) throw new DomainError('commitment_not_found', `No commitment ${id} for this user`)
    await requireAccount(tx, userId, accountId)
    await insertCommitmentEvent(tx, id, effectiveOn ?? today(), 'account_changed', null, null, accountId)
    return (await getCommitment(tx, userId, id))!
  })
}

/**
 * What a commitment says about itself, once it exists. Everything a person can
 * mistype when declaring it is here: its label, who bills it, how it is filed,
 * how often it falls.
 *
 * Three things stay out on purpose. The amount, because a price change is dated
 * history (changeAmount) and a financing's nominal amount derives from its
 * schedule. The account, for the same reason: a payment that moves accounts
 * does so on a date (moveAccount). And the direction, because an expense turned
 * income is not the same commitment corrected, it is another one: its own past
 * movements would contradict it.
 */
export interface CommitmentEdit {
  label?: string
  actorId?: string
  categoryId?: string | null
  activityId?: string | null
  periodUnit?: PeriodUnit
  periodCount?: number
  engagedUntil?: string | null
}

const EDITABLE = [
  'label',
  'actorId',
  'categoryId',
  'activityId',
  'periodUnit',
  'periodCount',
  'engagedUntil',
] as const

/**
 * Corrects an existing commitment. The movements it already produced are left
 * alone: they state what happened, on the account it happened on, and rewriting
 * them would move balances that were checked against a real bank. The
 * correction takes effect from the next occurrence.
 */
export async function editCommitment(userId: string, id: string, input: CommitmentEdit): Promise<Commitment> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const commitment = await getCommitmentForUpdate(tx, userId, id)
    if (!commitment) throw new DomainError('commitment_not_found', `No commitment ${id} for this user`)
    if (input.actorId !== undefined) await requireActor(tx, userId, input.actorId)
    if (commitment.kind === 'financing' && input.engagedUntil)
      throw new DomainError(
        'financing_has_no_lock_in',
        'A financing ends at its last installment: it carries no lock-in date',
      )

    const patch: Record<string, unknown> = {}
    for (const key of EDITABLE) if (input[key] !== undefined) patch[key] = input[key]
    if (Object.keys(patch).length === 0) return commitment
    return (await updateCommitment(tx, userId, id, patch))!
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
    // A judgment posed without a note keeps the note it had: the web offers no
    // note field, and its gesture must not erase what was written elsewhere.
    const updated = await updateCommitment(tx, userId, id, {
      judgment,
      ...(note !== undefined && { judgmentNote: note }),
    })
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

/** What one period of a commitment costs per month, in its own currency. */
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

/**
 * Same figure in euros at the latest rate, which is what every sum across
 * commitments must use: a USD line added as-is would count dollars as euros.
 * A commitment whose pair was never priced contributes nothing rather than a
 * guess; the row itself still shows its own currency.
 */
export function monthlyEquivalentEur(
  c: Pick<CommitmentWithEur, 'amountEur' | 'periodUnit' | 'periodCount'>,
): number {
  if (c.amountEur === null) return 0
  return monthlyEquivalent({ amount: c.amountEur, periodUnit: c.periodUnit, periodCount: c.periodCount })
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
  /**
   * The account it will hit: the one in force on its own date, which is not
   * always the one the commitment hits today. An occurrence left pending across
   * a move is exactly the case that used to land on the wrong account.
   */
  accountId: string
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
    const timeline = await accountTimeline(sql, commitment.id)
    if (commitment.kind === 'financing') {
      for (const installment of await dueInstallments(sql, commitment.id, limit))
        pending.push({
          commitment,
          dueOn: installment.dueOn,
          amount: Number(installment.amount),
          accountId: accountAt(timeline, installment.dueOn),
        })
      continue
    }
    let dueOn = commitment.nextDueOn
    while (dueOn <= limit) {
      pending.push({
        commitment,
        dueOn,
        amount: Number(commitment.amount),
        accountId: accountAt(timeline, dueOn),
      })
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
  overrides: {
    amount?: number
    happenedOn?: string
    updateReference?: boolean
    /**
     * Foreign-currency commitment only: the euros the bank actually moved,
     * when the statement shows them. Omitted, the movement's counter-value is
     * computed at the occurrence day's rate, like any declared movement.
     */
    eurAmount?: number
  } = {},
  history: HistoryFetcher = fetchHistory,
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
    const happenedOn = overrides.happenedOn ?? installment?.dueOn ?? commitment.nextDueOn
    const dueOn = installment?.dueOn ?? commitment.nextDueOn
    // An occurrence is about the month it was due, not the month it was paid.
    // A salary due on the 31st and confirmed on the 2nd belongs to the month
    // it pays for, and a rent due on the 1st was paid at the end of the month
    // before: re-typing that month on every salary and every rent would undo
    // the point of the field. Written only when the two months differ, so the
    // default stays unmaterialised and an ordinary occurrence keeps following
    // its date.
    const accrualMonth = dueOn.slice(0, 7) === happenedOn.slice(0, 7) ? undefined : dueOn.slice(0, 7)
    // The account is the one in force on the day the money moved, not the one
    // the commitment hits now: an occurrence confirmed after a move left the
    // old account, and writing it on the new one falsifies both balances.
    const accountId = accountAt(await accountTimeline(tx, commitment.id), happenedOn)
    const movement = await declareMovementIn(
      tx,
      userId,
      {
        happenedOn,
        // The occurrence's amount is in the commitment's currency: billed 10
        // USD, confirmed 10 USD, and the movement converts like any other.
        amount: overrides.amount ?? expected,
        currency: commitment.currency !== 'EUR' ? commitment.currency : undefined,
        eurAmount: overrides.eurAmount,
        sourceAccountId: outgoing ? accountId : undefined,
        targetActorId: outgoing ? commitment.actorId : undefined,
        sourceActorId: outgoing ? undefined : commitment.actorId,
        targetAccountId: outgoing ? undefined : accountId,
        categoryId: commitment.categoryId ?? undefined,
        activityId: commitment.activityId,
        commitmentId: commitment.id,
        accrualMonth,
      },
      history,
    )
    const confirmedAmount = overrides.amount ?? expected

    if (installment) {
      // The schedule records what was really paid, and when: the remaining due
      // (the sum of the unpaid lines) stays exact without recomputing anything,
      // and a settled line reads as the payment it was.
      await settleInstallment(tx, installment.id, movement.id, {
        amount: confirmedAmount,
        on: movement.happenedOn,
      })
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
      await insertCommitmentEvent(
        tx,
        id,
        movement.happenedOn,
        'price_changed',
        confirmedAmount,
        null,
        null,
        commitment.currency,
      )
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

/** One line of a revised plan: an installment being kept, or a new one. */
export interface ScheduleRevisionLine {
  /** Id of the installment this line keeps. Omitted for an added one. */
  id?: string
  dueOn: string
  amount: number
}

/**
 * Rewrites the plan of an existing financing: a date pushed back, a
 * renegotiated amount, an installment added or dropped. A written plan that
 * cannot be corrected is worse than no plan at all, because the remaining due
 * derives from it and would stay wrong forever.
 *
 * The revision is the whole plan, not a patch: the caller sends the lines it
 * wants, keeping an id for each one it keeps, and their order becomes the
 * contractual order. What that implies:
 *
 * - the total owed follows the plan (it is its sum), so a settlement or a
 *   commercial gesture is expressible instead of requiring a new financing;
 * - a settled installment carries what really left the account, so revising
 *   its amount corrects its movement too, and dropping the line deletes that
 *   movement: a plan without the installment must not keep what paid it;
 * - everything the financing derives (installment count, total, nominal
 *   amount, next due date) is recomputed from the rows, once, at the end.
 */
export async function reviseSchedule(
  userId: string,
  id: string,
  lines: ScheduleRevisionLine[],
  history: HistoryFetcher = fetchHistory,
): Promise<Commitment> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const commitment = await getCommitmentForUpdate(tx, userId, id)
    if (!commitment) throw new DomainError('commitment_not_found', `No commitment ${id} for this user`)
    if (commitment.kind !== 'financing')
      throw new DomainError('not_a_financing', 'Only a financing carries a written schedule')
    if (lines.length === 0)
      throw new DomainError(
        'schedule_empty',
        'A financing keeps at least one installment: close it instead of emptying its plan',
      )

    const current = await listInstallmentsForUpdate(tx, id)
    const known = new Map(current.map((installment) => [installment.id, installment]))
    const kept = new Set<string>()
    for (const line of lines) {
      if (line.id === undefined) continue
      if (!known.has(line.id))
        throw new DomainError('installment_not_found', `No installment ${line.id} in this financing`)
      if (kept.has(line.id))
        throw new DomainError('installment_repeated', `Installment ${line.id} appears twice in the revision`)
      kept.add(line.id)
    }

    // A dropped line takes its movement with it: leaving the movement behind
    // would keep charging an installment the plan no longer has.
    const dropped = current.filter((installment) => !kept.has(installment.id))
    for (const installment of dropped)
      if (installment.movementId) await deleteMovementIn(tx, userId, installment.movementId)
    await deleteInstallments(
      tx,
      dropped.map((installment) => installment.id),
    )

    // Positions are renumbered from the given order, so the old ones are moved
    // out of the way first: the (commitment, position) unique index is checked
    // row by row, not at commit time.
    const highest = current.reduce((max, installment) => Math.max(max, installment.position), 0)
    await shiftPositions(tx, id, highest + lines.length)

    const added: NewInstallment[] = []
    for (const [index, line] of lines.entries()) {
      const position = index + 1
      if (line.id === undefined) {
        added.push({ position, dueOn: line.dueOn, amount: line.amount })
        continue
      }
      await updateInstallmentPlan(tx, line.id, { position, dueOn: line.dueOn, amount: line.amount })
      const existing = known.get(line.id)!
      // A settled line and its movement say the same thing, whichever side is
      // edited: revising one carries the correction over to the other.
      const amountChanged = Number(existing.amount) !== line.amount
      if (existing.movementId && (amountChanged || existing.dueOn !== line.dueOn))
        // The plan is written in the commitment's currency, so on a foreign
        // one a changed amount redeclares the paid side and the euros are
        // reconverted at the day's rate. A date moved alone keeps the euros:
        // what the bank did is not rewritten for a calendar fix (same rule as
        // fix_movement), and an old line stays revisable even when the stored
        // rate history no longer covers its day.
        await correctMovementIn(
          tx,
          userId,
          existing.movementId,
          {
            ...(amountChanged
              ? {
                  amount: line.amount,
                  currency: commitment.currency !== 'EUR' ? commitment.currency : undefined,
                }
              : {}),
            happenedOn: line.dueOn,
          },
          history,
        )
    }
    await insertInstallments(tx, id, added)

    await resyncFinancing(tx, id)
    return (await getCommitment(tx, userId, id))!
  })
}
