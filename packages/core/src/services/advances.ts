import { db, type Executor } from '../db/client.ts'
import { getActor } from '../db/datasources/actors.ts'
import {
  deleteShare,
  detachRefunds,
  getShareForUpdate,
  insertShare,
  installmentsOfShares,
  listOpenShares,
  refundedOnShare,
  replaceInstallments,
  setShareClosed,
  sharesByIds,
  sharesOfCommitments,
  sharesOfMovement,
  updateShareAmount,
} from '../db/datasources/advances.ts'
import { getCommitment } from '../db/datasources/commitments.ts'
import { installmentByMovement, listInstallments } from '../db/datasources/installments.ts'
import { getMovement } from '../db/datasources/movements.ts'
import { checkShares, type ShareInput, type ShareProgress, shareProgress } from '../domain/advance.ts'
import { DomainError } from '../domain/errors.ts'
import { addPeriod, today } from '../domain/period.ts'
import type {
  AdvanceShare,
  Commitment,
  Movement,
  PeriodUnit,
  ShareInstallment,
  ShareState,
} from '../domain/types.ts'

/**
 * Advances: money paid for someone else, and what they owe back of it.
 *
 * One mechanism, whatever was advanced. A share says who owes how much, on one
 * expense or on a commitment; a refund is an income pointing at the share it
 * pays back; what is still owed is derived from the two, never stored. The
 * movement, subscription and financing services state their shares here, so
 * the rules below hold the same everywhere:
 *
 * - the shares of one thing never add up to more than it cost, and a person
 *   owes once on one thing (checkShares);
 * - only an expense is advanced: a transfer moves the person's own money, and
 *   an income is not owed back;
 * - what came back is a fact: a share is never lowered below it, and dropping
 *   a share that has refunds turns them back into plain incomes, which only
 *   happens when asked for by name (removeShare), never as a side effect of
 *   restating a list;
 * - a refund comes from the person whose share it pays back, into an account,
 *   and the refunds of a share never add up to more than it.
 */

async function requireDebtors(tx: Executor, userId: string, shares: ShareInput[]): Promise<void> {
  for (const share of shares)
    if (share.debtorActorId && !(await getActor(tx, userId, share.debtorActorId)))
      throw new DomainError('actor_not_found', `No refunding actor ${share.debtorActorId} for this user`)
}

/**
 * Makes the stored shares of one thing match a list, matched by debtor: a
 * share kept keeps its refunds and its plan, a new one is added, one missing
 * from the list is dropped. Dropping or lowering what has refunds is refused
 * here: those go through removeShare, which says what it detaches.
 */
async function reconcile(
  tx: Executor,
  userId: string,
  current: ShareState[],
  wanted: (ShareInput & { perOccurrence?: boolean })[],
  owner: { movementId?: string; commitmentId?: string },
): Promise<void> {
  // A share per occurrence and a claim on the whole are two different
  // promises: switching one into the other is dropping it and stating anew.
  const key = (debtor: string, perOccurrence = false) => `${debtor}:${perOccurrence}`
  const byDebtor = new Map(current.map((s) => [key(s.debtorActorId, s.perOccurrence), s]))
  const kept = new Set(wanted.flatMap((w) => byDebtor.get(key(w.debtorActorId, w.perOccurrence))?.id ?? []))
  // Dropped first, so a person switching from one kind of share to the other
  // never holds two at once.
  for (const share of current) {
    if (kept.has(share.id)) continue
    if (Number(share.refunded) > 0)
      throw new DomainError(
        'advance_has_refund',
        'A refund is already linked to this share: remove the share by name to turn its refunds back into incomes',
      )
    await deleteShare(tx, share.id)
  }
  const plans = await installmentsOfShares(tx, [...kept])
  for (const share of wanted) {
    const existing = byDebtor.get(key(share.debtorActorId, share.perOccurrence))
    if (!existing) {
      await insertShare(tx, {
        userId,
        movementId: owner.movementId,
        commitmentId: owner.commitmentId,
        perOccurrence: share.perOccurrence,
        debtorActorId: share.debtorActorId,
        amount: share.amount,
      })
      continue
    }
    if (Number(existing.amount) === share.amount) continue
    if (share.amount < Number(existing.refunded))
      throw new DomainError(
        'advance_below_refunds',
        `The amount expected back cannot be lower than the ${existing.refunded} already refunded`,
      )
    if (plans.some((line) => line.shareId === existing.id))
      throw new DomainError(
        'share_has_schedule',
        'This share has a repayment plan adding up to its amount: restate the plan with the new amount',
      )
    await updateShareAmount(tx, existing.id, share.amount)
  }
}

/** Only an expense is advanced: money that left one of the person's accounts for someone outside. */
function requireExpense(m: Pick<Movement, 'sourceAccountId' | 'targetActorId'>): void {
  if (!(m.sourceAccountId && m.targetActorId))
    throw new DomainError(
      'advance_is_expense',
      'Only an expense can be an advance: a transfer or an income cannot be owed back',
    )
}

/**
 * What the shares of an expense of its own may claim of it: all of it, except
 * on an installment of a financing claimed on its total, whose claims already
 * take their part of it (the share of the total that installment is), and
 * which the person owing on the total pays back there, never here.
 */
async function claimableOf(
  tx: Executor,
  userId: string,
  movement: Pick<Movement, 'id' | 'amount'>,
): Promise<{ cost: number; onTotal: ShareState[] }> {
  const amount = Number(movement.amount)
  const installment = await installmentByMovement(tx, movement.id)
  if (!installment) return { cost: amount, onTotal: [] }
  const financing = await getCommitment(tx, userId, installment.commitmentId)
  const onTotal = (await sharesOfCommitments(tx, [installment.commitmentId])).filter((s) => !s.perOccurrence)
  if (!financing || onTotal.length === 0) return { cost: amount, onTotal }
  const claimed = onTotal.reduce((sum, s) => sum + Number(s.amount), 0)
  return { cost: Math.round(amount * (1 - claimed / Number(financing.totalAmount)) * 100) / 100, onTotal }
}

/**
 * States who owes what of an expense. Undefined restates nothing, but still
 * checks the stored shares against the movement as it now is, since a
 * correction of its amount or of its nature must not leave them behind.
 */
export async function setMovementSharesIn(
  tx: Executor,
  userId: string,
  movement: Movement,
  shares: ShareInput[] | undefined,
): Promise<void> {
  const current = await sharesOfMovement(tx, movement.id)
  const wanted = shares ?? current.map((s) => ({ debtorActorId: s.debtorActorId, amount: Number(s.amount) }))
  if (wanted.length === 0 && current.length === 0) return
  if (wanted.length > 0) requireExpense(movement)
  await requireDebtors(tx, userId, wanted)
  if (wanted.length > 0) checkShares(wanted, (await claimableOf(tx, userId, movement)).cost)
  if (shares !== undefined) await reconcile(tx, userId, current, wanted, { movementId: movement.id })
}

/** A share of each occurrence, or of a financing's total. */
export interface CommitmentShareInput extends ShareInput {
  /** Every occurrence carries it. Always the case on a subscription; on a financing, the other way is the total. */
  perOccurrence: boolean
}

/**
 * States who owes what of a commitment. On a subscription a share is always
 * per occurrence: it has no total to owe. On a financing each share is one or
 * the other, and the two add up on every instalment: what the shares per
 * instalment take of it, plus what the claims on the total take of it (its
 * part of the total), never exceeds the instalment. A share per occurrence is
 * part of a price, in its billing currency; a claim on the total is euros, so
 * only a financing in euros takes one.
 *
 * Undefined restates nothing and checks the stored shares against the
 * commitment as it now is (a new price, a new plan).
 */
export async function setCommitmentSharesIn(
  tx: Executor,
  userId: string,
  commitment: Pick<Commitment, 'id' | 'kind' | 'direction' | 'amount' | 'currency' | 'totalAmount'>,
  shares: CommitmentShareInput[] | undefined,
): Promise<void> {
  const current = await sharesOfCommitments(tx, [commitment.id])
  const wanted =
    shares ??
    current.map((s) => ({
      debtorActorId: s.debtorActorId,
      amount: Number(s.amount),
      perOccurrence: s.perOccurrence,
    }))
  if (wanted.length === 0 && current.length === 0) return
  if (wanted.length > 0) {
    if (
      commitment.direction !== 'outgoing' ||
      (commitment.kind !== 'subscription' && commitment.kind !== 'financing')
    )
      throw new DomainError(
        'advance_is_expense',
        'Only an outgoing subscription or a financing can be partly refunded: its occurrences are expenses',
      )
    const each = wanted.filter((s) => s.perOccurrence)
    const whole = wanted.filter((s) => !s.perOccurrence)
    if (whole.length > 0 && commitment.kind !== 'financing')
      throw new DomainError(
        'claim_needs_financing',
        'Only a financing has a total to owe: a subscription is shared per occurrence',
      )
    if (whole.length > 0 && commitment.currency !== 'EUR')
      throw new DomainError(
        'claim_needs_eur',
        'A claim on a financing’s total is in euros: share a financing billed in another currency per instalment',
      )
    await requireDebtors(tx, userId, wanted)
    // A person owes once on one thing, whichever way.
    checkShares(wanted, Number.POSITIVE_INFINITY)
    checkShares(whole, Number(commitment.totalAmount), 'the financing’s total')
    if (commitment.kind !== 'financing')
      checkShares(each, Number(commitment.amount), 'the price of one occurrence')
    else await checkInstalments(tx, commitment, each, whole)
  }
  if (shares === undefined) return
  await reconcile(tx, userId, current, wanted, { commitmentId: commitment.id })
}

/**
 * Every instalment of a financing covers what its shares take of it: the
 * shares per instalment in full, the claims on the total for the part of the
 * total that instalment is.
 */
async function checkInstalments(
  tx: Executor,
  commitment: Pick<Commitment, 'id' | 'totalAmount'>,
  each: ShareInput[],
  whole: ShareInput[],
): Promise<void> {
  if (each.length === 0) return
  const perInstalment = each.reduce((sum, s) => sum + Math.round(s.amount * 100), 0)
  const claimed = whole.reduce((sum, s) => sum + Math.round(s.amount * 100), 0)
  const total = Math.round(Number(commitment.totalAmount) * 100)
  for (const line of await listInstallments(tx, commitment.id)) {
    const cents = Math.round(Number(line.amount) * 100)
    if (perInstalment + (cents * claimed) / total > cents + 0.5)
      throw new DomainError(
        'advance_amount_too_large',
        `The shares of instalment ${line.position} (${((perInstalment + (cents * claimed) / total) / 100).toFixed(2)}) cannot exceed it (${line.amount})`,
      )
  }
}

/**
 * The shares an occurrence of a commitment carries once confirmed, on its
 * movement. Each is the rule's amount, in the billing currency, re-said in
 * the euros the movement holds at the rate it was converted at, so a share
 * stays the same part of what was paid.
 */
export async function occurrenceShares(
  tx: Executor,
  commitmentId: string,
  movement: Pick<Movement, 'amount' | 'originalAmount'>,
): Promise<ShareInput[] | undefined> {
  const rules = (await sharesOfCommitments(tx, [commitmentId])).filter((s) => s.perOccurrence)
  if (rules.length === 0) return undefined
  const rate =
    movement.originalAmount === null ? 1 : Number(movement.amount) / Number(movement.originalAmount)
  return rules.map((s) => ({
    debtorActorId: s.debtorActorId,
    amount: Math.round(Number(s.amount) * rate * 100) / 100,
  }))
}

/** What the shares per occurrence of a commitment add up to, in its billing currency; null when nobody pays any back. */
export async function shareOfEachOccurrence(
  tx: Executor,
  commitmentIds: string[],
): Promise<Map<string, number>> {
  const sums = new Map<string, number>()
  for (const s of await sharesOfCommitments(tx, commitmentIds))
    if (s.perOccurrence)
      sums.set(s.commitmentId!, Math.round(((sums.get(s.commitmentId!) ?? 0) + Number(s.amount)) * 100) / 100)
  return sums
}

/** How an income says what it pays back: one share, or an expense, the share then being its debtor's. */
export interface RefundTarget {
  refundsShareId?: string
  refundsMovementId?: string
}

/**
 * Resolves and checks the share an income pays back. Given an expense rather
 * than a share, the share is the one of the person the money came from, and
 * when that person owes nothing on it yet, the share is created for what the
 * income brings: the money came back before the expense was declared an
 * advance, or before it was paid at all. Returns null when the income pays
 * nothing back.
 */
export async function refundShareFor(
  tx: Executor,
  userId: string,
  income: {
    sourceActorId?: string
    targetAccountId?: string
    amount: number
    cardId?: string
  },
  target: RefundTarget,
  /** On a correction: the income being corrected, left out of what the share already received. */
  except?: string,
): Promise<string | null> {
  if (!target.refundsShareId && !target.refundsMovementId) return null
  if (!(income.sourceActorId && income.targetAccountId))
    throw new DomainError(
      'refund_is_income',
      'Only an income pays an advance back: money coming from someone into one of your accounts',
    )
  let shareId = target.refundsShareId
  if (!shareId) {
    const advanced = await getMovement(tx, userId, target.refundsMovementId!)
    if (!advanced)
      throw new DomainError('movement_not_found', `No movement ${target.refundsMovementId} for this user`)
    const current = await sharesOfMovement(tx, advanced.id)
    const claimable = await claimableOf(tx, userId, advanced)
    // An installment of a financing they owe on: the refund pays that claim,
    // never a second share of the same money.
    const theirs =
      current.find((s) => s.debtorActorId === income.sourceActorId) ??
      claimable.onTotal.find((s) => s.debtorActorId === income.sourceActorId)
    if (theirs) shareId = theirs.id
    else {
      requireExpense(advanced)
      const wanted = [
        ...current.map((s) => ({ debtorActorId: s.debtorActorId, amount: Number(s.amount) })),
        { debtorActorId: income.sourceActorId, amount: income.amount },
      ]
      checkShares(wanted, claimable.cost)
      shareId = (
        await insertShare(tx, {
          userId,
          movementId: advanced.id,
          debtorActorId: income.sourceActorId,
          amount: income.amount,
        })
      ).id
    }
  }
  const share = await getShareForUpdate(tx, userId, shareId)
  if (!share) throw new DomainError('claim_not_found', `No share ${shareId} for this user`)
  if (share.perOccurrence)
    throw new DomainError(
      'claim_is_a_rule',
      'This share is the rule every occurrence copies: a refund pays back the share of one occurrence, on its movement',
    )
  if (share.debtorActorId !== income.sourceActorId)
    throw new DomainError(
      'refund_other_debtor',
      'A refund comes from the person whose share it pays back: this income comes from someone else',
    )
  const received = (await refundedOnShare(tx, share.id, except)) + income.amount
  if (received > Number(share.amount) + 0.005)
    throw new DomainError(
      'refund_above_share',
      `This refund brings what came back on the share to ${received.toFixed(2)}, above the ${share.amount} owed: raise the share first, or link the income elsewhere`,
    )
  return share.id
}

/** One share, with what came back on it. */
export async function getShare(userId: string, shareId: string): Promise<ShareState> {
  const share = await getShareForUpdate(db(), userId, shareId)
  if (!share) throw new DomainError('claim_not_found', `No share ${shareId} for this user`)
  return share
}

/** Writes off what will never come back on a share: it stops being awaited, the expense stays whole. */
export async function closeShare(userId: string, shareId: string): Promise<AdvanceShare> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const share = await getShareForUpdate(tx, userId, shareId)
    if (!share) throw new DomainError('claim_not_found', `No share ${shareId} for this user`)
    if (share.perOccurrence)
      throw new DomainError(
        'claim_is_a_rule',
        'This share is the rule every occurrence copies: write off the share of one occurrence, or drop the rule',
      )
    await setShareClosed(tx, share.id, true)
    return { ...share, closed: true }
  })
}

/**
 * Drops a share, by name: nobody owes it any more, or it was stated on the
 * wrong person. The refunds it had are not deleted, the money did come in:
 * they become plain incomes again, and the caller says so before asking.
 * Returns the incomes it detached.
 */
export async function removeShare(userId: string, shareId: string): Promise<string[]> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const share = await getShareForUpdate(tx, userId, shareId)
    if (!share) throw new DomainError('claim_not_found', `No share ${shareId} for this user`)
    const detached = await detachRefunds(tx, share.id)
    await deleteShare(tx, share.id)
    return detached
  })
}

/** A repayment plan: generated from a count and a rhythm, or stated line by line. */
export type SchedulePlan =
  | { count: number; firstDueOn: string; periodUnit?: PeriodUnit; periodCount?: number }
  | { lines: { dueOn: string; amount: number }[] }

/**
 * When a debtor said they would pay a share back. Like a financing's plan,
 * stated as N equal amounts one period apart (the last one carrying the
 * rounding), or line by line when the promise is uneven. Either way it adds
 * up to the share exactly, so "late" always compares like with like; null
 * drops the plan, and the share is then never late, nobody having said when.
 */
export async function setShareSchedule(
  userId: string,
  shareId: string,
  plan: SchedulePlan | null,
): Promise<ShareInstallment[]> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const share = await getShareForUpdate(tx, userId, shareId)
    if (!share) throw new DomainError('claim_not_found', `No share ${shareId} for this user`)
    if (share.perOccurrence)
      throw new DomainError(
        'claim_is_a_rule',
        'This share is the rule every occurrence copies: plan the repayment of one occurrence, on its movement',
      )
    if (plan === null) {
      await replaceInstallments(tx, share.id, [])
      return []
    }
    const lines = 'lines' in plan ? plan.lines : evenPlan(Number(share.amount), plan)
    if (lines.length === 0)
      throw new DomainError('schedule_empty', 'A plan has at least one line: drop the plan instead')
    for (const line of lines)
      if (!(line.amount > 0)) throw new DomainError('bad_amount', 'An amount is always positive')
    const planned = lines.reduce((sum, line) => sum + Math.round(line.amount * 100), 0)
    if (planned !== Math.round(Number(share.amount) * 100))
      throw new DomainError(
        'schedule_sum_mismatch',
        `The plan adds up to ${planned / 100} but the share is ${share.amount}`,
      )
    await replaceInstallments(tx, share.id, lines)
    return await installmentsOfShares(tx, [share.id])
  })
}

function evenPlan(
  total: number,
  plan: { count: number; firstDueOn: string; periodUnit?: PeriodUnit; periodCount?: number },
): { dueOn: string; amount: number }[] {
  if (!(Number.isInteger(plan.count) && plan.count > 0))
    throw new DomainError('bad_count', 'A plan has a whole, positive number of payments')
  const cents = Math.round(total * 100)
  const each = Math.floor(cents / plan.count)
  const lines: { dueOn: string; amount: number }[] = []
  let dueOn = plan.firstDueOn
  for (let position = 1; position <= plan.count; position++) {
    const amount = position === plan.count ? cents - each * (plan.count - 1) : each
    lines.push({ dueOn, amount: amount / 100 })
    dueOn = addPeriod(dueOn, plan.periodUnit ?? 'month', plan.periodCount ?? 1)
  }
  return lines
}

/** A claim still awaited, with what it was advanced on and what its plan says today. */
export interface OpenClaim extends ShareProgress {
  share: ShareState
  remaining: number
  plan: ShareInstallment[]
  /** The expense it was advanced on, or the financing it is a claim on. */
  movement: Movement | null
  commitment: Commitment | null
  /** Where its refunds land: the account that paid. */
  accountId: string
}

/**
 * Every claim still awaited, one per person and per thing advanced: an
 * expense several people owe on is as many claims, each paid back and late on
 * its own.
 */
export async function openClaims(userId: string, on = today()): Promise<OpenClaim[]> {
  const sql = db()
  const shares = await listOpenShares(sql, userId)
  const plans = await installmentsOfShares(
    sql,
    shares.map((s) => s.id),
  )
  const claims = await Promise.all(
    shares.map(async (share): Promise<OpenClaim> => {
      const movement = share.movementId ? ((await getMovement(sql, userId, share.movementId)) ?? null) : null
      const commitment = share.commitmentId
        ? ((await getCommitment(sql, userId, share.commitmentId)) ?? null)
        : null
      const plan = plans.filter((line) => line.shareId === share.id)
      return {
        share,
        remaining: Math.round((Number(share.amount) - Number(share.refunded)) * 100) / 100,
        plan,
        movement,
        commitment,
        accountId: movement?.sourceAccountId ?? commitment!.accountId,
        ...shareProgress(share, plan, on),
      }
    }),
  )
  // The oldest first, the order they were advanced in.
  return claims.sort((a, b) => claimDate(a).localeCompare(claimDate(b)))
}

function claimDate(c: OpenClaim): string {
  return c.movement?.purchasedOn ?? c.movement?.happenedOn ?? c.commitment?.nextDueOn ?? ''
}

/** The shares of commitments, for the screens and tools that state them. */
export async function commitmentShares(userId: string, commitmentIds: string[]): Promise<ShareState[]> {
  return (await sharesOfCommitments(db(), commitmentIds)).filter((s) => s.userId === userId)
}

/** The plans of some shares, for the screens and tools that read them. */
export async function sharePlans(shareIds: string[]): Promise<ShareInstallment[]> {
  return await installmentsOfShares(db(), shareIds)
}

/** What some shares were advanced on, for an interface naming the claim a refund pays back. */
export async function describeShares(
  userId: string,
  shareIds: string[],
): Promise<Map<string, { share: ShareState; movement: Movement | null; commitment: Commitment | null }>> {
  const sql = db()
  const described = new Map<
    string,
    { share: ShareState; movement: Movement | null; commitment: Commitment | null }
  >()
  // A read for a screen: no row lock, unlike the gestures that change a share.
  for (const share of await sharesByIds(sql, userId, [...new Set(shareIds)])) {
    described.set(share.id, {
      share,
      movement: share.movementId ? ((await getMovement(sql, userId, share.movementId)) ?? null) : null,
      commitment: share.commitmentId
        ? ((await getCommitment(sql, userId, share.commitmentId)) ?? null)
        : null,
    })
  }
  return described
}
