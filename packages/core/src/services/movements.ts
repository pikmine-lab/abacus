import { db, type Executor } from '../db/client.ts'
import { getAccount } from '../db/datasources/accounts.ts'
import { getActor } from '../db/datasources/actors.ts'
import {
  alignInstallmentOnMovement,
  installmentByMovement,
  resyncFinancing,
} from '../db/datasources/installments.ts'
import {
  deleteMovementRow,
  getMovement,
  insertMovement,
  listMovements as listMovementsDs,
  listOutstandingAdvances,
  type MovementFilters,
  type MovementSelection,
  refundedSoFar,
  selectionTotals as selectionTotalsDs,
  setRefundClosed,
  updateMovementRow,
} from '../db/datasources/movements.ts'
import { DomainError } from '../domain/errors.ts'
import { today } from '../domain/period.ts'
import type { Account, Actor, Movement } from '../domain/types.ts'
import { fetchHistory, type HistoryFetcher } from '../prices/sources.ts'
import { eurRateOn, toEur } from './fx.ts'

export interface DeclareMovementInput {
  happenedOn: string
  /** In `currency`: euros unless another code says what was actually paid. */
  amount: number
  /**
   * ISO 4217 code of the amount as it was paid. Foreign: the movement stores
   * its EUR counter-value (the account holds euros), the original alongside.
   */
  currency?: string
  /**
   * With a foreign currency only: the euros the bank actually moved, when the
   * statement says so. Omitted, the counter-value is computed at the
   * transaction day's rate.
   */
  eurAmount?: number
  sourceAccountId?: string
  sourceActorId?: string
  targetAccountId?: string
  targetActorId?: string
  categoryId?: string
  /** Omitted: inherited from the external actor. Explicit null: none. */
  activityId?: string | null
  note?: string
  commitmentId?: string
  balanceCheckId?: string
  /** Marks the expense as an advance to be refunded by this actor. */
  expectedRefundFromActorId?: string
  /** How much of the expense is owed back. Required with a refunding actor. */
  expectedRefundAmount?: number
  /** Links this income to the advanced expense it refunds. */
  refundsMovementId?: string
  /**
   * The advance came back the same day: the refund income is written in the
   * same transaction, so the account balance never lies in between.
   */
  refundedNow?: boolean
}

async function requireAccount(tx: Executor, userId: string, id: string, role: string): Promise<Account> {
  const account = await getAccount(tx, userId, id)
  if (!account) throw new DomainError('account_not_found', `No ${role} account ${id} for this user`)
  return account
}

async function requireActor(tx: Executor, userId: string, id: string, role: string): Promise<Actor> {
  const actor = await getActor(tx, userId, id)
  if (!actor) throw new DomainError('actor_not_found', `No ${role} actor ${id} for this user`)
  return actor
}

/**
 * What actually hit the account, resolved once. Accounts hold euros, so a
 * foreign amount is converted at the transaction day's rate and frozen (a past
 * expense does not move with today's rate); the bank's own figure wins when
 * the statement gives it. The declared amount stays alongside as the original.
 */
async function inAccountCurrency(
  tx: Executor,
  input: DeclareMovementInput,
  history: HistoryFetcher,
): Promise<DeclareMovementInput & { originalAmount?: number; originalCurrency?: string }> {
  const code = (input.currency ?? 'EUR').toUpperCase()
  if (code === 'EUR') {
    if (input.eurAmount !== undefined)
      throw new DomainError(
        'needless_eur_amount',
        'eurAmount only goes with a foreign currency: the amount is already in euros',
      )
    return { ...input, currency: 'EUR', originalAmount: undefined, originalCurrency: undefined }
  }
  if (input.sourceAccountId && input.targetAccountId)
    throw new DomainError(
      'transfer_stays_eur',
      'A transfer between two of your accounts moves euros: declare it in euros',
    )
  if (input.eurAmount !== undefined && !(input.eurAmount > 0))
    throw new DomainError('bad_amount', 'An amount is always positive')
  const eur = input.eurAmount ?? toEur(input.amount, await eurRateOn(tx, code, input.happenedOn, history))
  if (!(eur > 0)) throw new DomainError('bad_amount', `${input.amount} ${code} converts to less than a cent`)
  return {
    ...input,
    amount: eur,
    currency: 'EUR',
    eurAmount: undefined,
    originalAmount: input.amount,
    originalCurrency: code,
  }
}

/**
 * Transaction-aware variant, so other services (commitment confirmation,
 * balance adjustments) can declare a movement inside their own transaction.
 */
export async function declareMovementIn(
  tx: Executor,
  userId: string,
  input: DeclareMovementInput,
  history: HistoryFetcher = fetchHistory,
): Promise<Movement> {
  const resolved = await inAccountCurrency(tx, input, history)
  const activityId = await checkMovement(tx, userId, resolved)
  const { refundedNow, eurAmount: _, ...row } = resolved
  const movement = await insertMovement(tx, { ...row, userId, activityId })
  if (refundedNow) await writeRefundIn(tx, userId, movement, {})
  return movement
}

/**
 * The income that brings an advance back: it lands on the account that paid,
 * comes from the actor who owed it, and defaults to what is still owed. One
 * place decides that, because the web panel, the MCP and an advance refunded
 * on the spot must all write the same movement.
 */
async function writeRefundIn(
  tx: Executor,
  userId: string,
  advance: Movement,
  { amount, on }: { amount?: number; on?: string },
): Promise<Movement> {
  if (!advance.expectedRefundFromActorId || !advance.expectedRefundAmount)
    throw new DomainError('not_an_advance', 'This movement is not marked as an advance')
  const owed = Number(advance.expectedRefundAmount) - Number(await refundedSoFar(tx, advance.id))
  const received = amount ?? owed
  if (!(received > 0))
    throw new DomainError('advance_settled', 'This advance has already been refunded in full')
  return await declareMovementIn(tx, userId, {
    happenedOn: on ?? advance.happenedOn,
    amount: received,
    currency: advance.currency,
    sourceActorId: advance.expectedRefundFromActorId,
    targetAccountId: advance.sourceAccountId!,
    refundsMovementId: advance.id,
  })
}

/**
 * The domain rules a movement must satisfy, whether it is being declared or
 * corrected: exactly one endpoint per side, at least one owned account, no
 * category on a transfer, no writing onto a closed account, a refund pointing
 * at a real advance. Returns the activity to store (inherited unless set).
 */
async function checkMovement(
  tx: Executor,
  userId: string,
  input: DeclareMovementInput,
): Promise<string | null> {
  if ((input.sourceAccountId ? 1 : 0) + (input.sourceActorId ? 1 : 0) !== 1)
    throw new DomainError('bad_source', 'A movement needs exactly one source: an account or an actor')
  if ((input.targetAccountId ? 1 : 0) + (input.targetActorId ? 1 : 0) !== 1)
    throw new DomainError('bad_target', 'A movement needs exactly one target: an account or an actor')
  if (input.sourceActorId && input.targetActorId)
    throw new DomainError('no_owned_account', 'A movement must touch at least one of your accounts')

  const accounts = await Promise.all([
    input.sourceAccountId ? requireAccount(tx, userId, input.sourceAccountId, 'source') : null,
    input.targetAccountId ? requireAccount(tx, userId, input.targetAccountId, 'target') : null,
  ])
  for (const account of accounts) {
    if (account?.closedOn && input.happenedOn > account.closedOn)
      throw new DomainError('account_closed', `Account "${account.name}" is closed since ${account.closedOn}`)
  }

  const isTransfer = Boolean(input.sourceAccountId && input.targetAccountId)
  if (isTransfer && input.categoryId)
    throw new DomainError('transfer_has_no_category', 'An internal transfer carries no category')

  const externalActor = input.targetActorId
    ? await requireActor(tx, userId, input.targetActorId, 'target')
    : input.sourceActorId
      ? await requireActor(tx, userId, input.sourceActorId, 'source')
      : null

  if (input.expectedRefundFromActorId)
    await requireActor(tx, userId, input.expectedRefundFromActorId, 'refunding')
  checkAdvanceShare(input)

  if (input.refundsMovementId) {
    const advanced = await getMovement(tx, userId, input.refundsMovementId)
    if (!advanced)
      throw new DomainError('movement_not_found', `No movement ${input.refundsMovementId} for this user`)
    if (!advanced.expectedRefundFromActorId)
      throw new DomainError('not_an_advance', 'The linked movement is not marked as an advance')
  }

  // Inherited from the actor at write time on purpose: history stays stable,
  // reclassifying it later is an explicit action.
  return input.activityId !== undefined ? input.activityId : (externalActor?.activityId ?? null)
}

/**
 * An advance says who owes and how much: the two travel together, because a
 * claim without an amount would silently mean "the whole expense", which is
 * exactly the guess that made splitting a bill inexpressible.
 */
function checkAdvanceShare(input: DeclareMovementInput): void {
  const { expectedRefundFromActorId: debtor, expectedRefundAmount: share } = input
  if ((debtor || share !== undefined) && !(input.sourceAccountId && input.targetActorId))
    throw new DomainError(
      'advance_is_expense',
      'Only an expense can be an advance: a transfer or an income cannot be owed back',
    )
  if (debtor && share === undefined)
    throw new DomainError('advance_needs_amount', 'An advance needs the amount expected back')
  if (share !== undefined && !debtor)
    throw new DomainError('advance_needs_actor', 'An expected refund needs the actor who owes it')
  if (share === undefined) return
  if (!(share > 0))
    throw new DomainError('advance_amount_invalid', 'The amount expected back must be positive')
  if (share > input.amount)
    throw new DomainError(
      'advance_amount_too_large',
      `The amount expected back (${share}) cannot exceed the expense (${input.amount})`,
    )
}

export async function declareMovement(
  userId: string,
  input: DeclareMovementInput,
  history: HistoryFetcher = fetchHistory,
): Promise<Movement> {
  const sql = db()
  return await sql.begin(async (tx) => declareMovementIn(tx, userId, input, history))
}

export type { MovementFilters, MovementSelection }

/** Fields a correction may touch; anything absent keeps its current value. */
export interface CorrectMovementInput {
  happenedOn?: string
  /** Alone: the euros that hit the account. With `currency`: what was paid abroad. */
  amount?: number
  /**
   * Redeclares the money side, as on declaration: a foreign code converts the
   * amount at the day's rate (unless eurAmount gives the bank's figure) and
   * keeps the original alongside; 'EUR' drops a wrongly declared original.
   * Absent, the stored original is kept as it is.
   */
  currency?: string
  eurAmount?: number
  sourceAccountId?: string | null
  sourceActorId?: string | null
  targetAccountId?: string | null
  targetActorId?: string | null
  categoryId?: string | null
  activityId?: string | null
  note?: string | null
  expectedRefundFromActorId?: string | null
  expectedRefundAmount?: number | null
}

const CORRECTABLE = [
  'happenedOn',
  'amount',
  'sourceAccountId',
  'sourceActorId',
  'targetAccountId',
  'targetActorId',
  'categoryId',
  'activityId',
  'note',
  'expectedRefundFromActorId',
  'expectedRefundAmount',
] as const

/**
 * Corrects a declared movement. A declarative ledger is only as good as the
 * user's ability to fix a typo, so this exists: but it is a correction, not a
 * rewrite: the origin links (commitment, balance check, advance and refund
 * links) are never touched here, and the merged result must satisfy the same
 * domain rules as a fresh declaration.
 *
 * The stored activity is not re-inherited from a changed actor: history stays
 * stable unless the activity is set explicitly (same rule as declaration).
 */
export async function correctMovement(
  userId: string,
  id: string,
  input: CorrectMovementInput,
  history: HistoryFetcher = fetchHistory,
): Promise<Movement> {
  const sql = db()
  return await sql.begin(async (tx) => await correctMovementIn(tx, userId, id, input, history))
}

/**
 * Transaction-aware variant, so a schedule revision can correct the movements
 * of the installments it touches inside its own transaction.
 */
export async function correctMovementIn(
  tx: Executor,
  userId: string,
  id: string,
  input: CorrectMovementInput,
  history: HistoryFetcher = fetchHistory,
): Promise<Movement> {
  const current = await getMovement(tx, userId, id)
  if (!current) throw new DomainError('movement_not_found', `No movement ${id} for this user`)

  // Touching the currency redeclares the money side, so the amount defaults to
  // the stored original (the declared figure), not to its counter-value.
  const moneyTouched = input.currency !== undefined || input.eurAmount !== undefined
  const merged: DeclareMovementInput = {
    happenedOn: input.happenedOn ?? current.happenedOn,
    amount:
      input.amount ??
      (moneyTouched && current.originalAmount !== null
        ? Number(current.originalAmount)
        : Number(current.amount)),
    currency: moneyTouched ? (input.currency ?? current.originalCurrency ?? 'EUR') : 'EUR',
    eurAmount: input.eurAmount,
    sourceAccountId: pick(input, current, 'sourceAccountId'),
    sourceActorId: pick(input, current, 'sourceActorId'),
    targetAccountId: pick(input, current, 'targetAccountId'),
    targetActorId: pick(input, current, 'targetActorId'),
    categoryId: pick(input, current, 'categoryId'),
    note: pick(input, current, 'note'),
    // Explicit null keeps "no activity" from being re-inherited.
    activityId: input.activityId !== undefined ? input.activityId : current.activityId,
    expectedRefundFromActorId: pick(input, current, 'expectedRefundFromActorId'),
    expectedRefundAmount:
      input.expectedRefundAmount !== undefined
        ? (input.expectedRefundAmount ?? undefined)
        : current.expectedRefundAmount !== null
          ? Number(current.expectedRefundAmount)
          : undefined,
    refundsMovementId: current.refundsMovementId ?? undefined,
  }
  const resolved = moneyTouched
    ? await inAccountCurrency(tx, merged, history)
    : {
        ...merged,
        originalAmount: current.originalAmount !== null ? Number(current.originalAmount) : undefined,
        originalCurrency: current.originalCurrency ?? undefined,
      }
  const activityId = await checkMovement(tx, userId, resolved)

  // What has already come back is a fact: the claim it belongs to cannot be
  // dropped under it, nor shrunk below it.
  const received = Number(await refundedSoFar(tx, id))
  if (received > 0) {
    if (!resolved.expectedRefundFromActorId)
      throw new DomainError(
        'advance_has_refund',
        'A refund is already linked to this advance: delete that refund before dropping the claim',
      )
    if (resolved.expectedRefundAmount! < received)
      throw new DomainError(
        'advance_below_refunds',
        `The amount expected back cannot be lower than the ${received} already refunded`,
      )
  }

  const row: Record<string, unknown> = {
    activityId,
    originalAmount: resolved.originalAmount ?? null,
    originalCurrency: resolved.originalCurrency ?? null,
  }
  for (const key of CORRECTABLE) {
    if (key === 'activityId') continue
    row[key] = resolved[key] ?? null
  }
  const updated = await updateMovementRow(tx, userId, id, row)
  if (!updated) throw new DomainError('movement_not_found', `No movement ${id} for this user`)

  // A settled financing installment says what its movement says: the amount
  // debited and the day it was debited. Correcting one corrects the other, or
  // the plan drifts away from what actually left the account. On a foreign
  // plan the installment is written in the billing currency, which on the
  // movement is the original side, not its EUR counter-value.
  const settled = await installmentByMovement(tx, id)
  const paid = updated.originalAmount !== null ? Number(updated.originalAmount) : Number(updated.amount)
  if (settled && (Number(settled.amount) !== paid || settled.dueOn !== updated.happenedOn)) {
    await alignInstallmentOnMovement(tx, settled.id, { amount: paid, on: updated.happenedOn })
    await resyncFinancing(tx, settled.commitmentId)
  }
  return updated
}

function pick(
  input: CorrectMovementInput,
  current: Movement,
  key:
    | 'sourceAccountId'
    | 'sourceActorId'
    | 'targetAccountId'
    | 'targetActorId'
    | 'categoryId'
    | 'note'
    | 'expectedRefundFromActorId',
): string | undefined {
  const value = input[key] !== undefined ? input[key] : current[key]
  return value ?? undefined
}

/**
 * Removes a declared movement. Refused while another movement refunds it: the
 * refund would be left pointing at nothing, and the user has to decide which
 * of the two is wrong.
 *
 * When the movement settled a financing installment, that installment becomes
 * owed again (the foreign key frees it) and the plan's cursor is moved back
 * onto it, so what is due reappears instead of being silently skipped.
 */
export async function deleteMovement(userId: string, id: string): Promise<void> {
  const sql = db()
  await sql.begin(async (tx) => await deleteMovementIn(tx, userId, id))
}

/**
 * Transaction-aware variant, so dropping an installment from a plan can drop
 * the movement that paid it in the same transaction.
 */
export async function deleteMovementIn(tx: Executor, userId: string, id: string): Promise<void> {
  const movement = await getMovement(tx, userId, id)
  if (!movement) throw new DomainError('movement_not_found', `No movement ${id} for this user`)
  const [refund] = await tx<{ id: string }[]>`
    select id from movement where refunds_movement_id = ${id} limit 1
  `
  if (refund)
    throw new DomainError('refunded_movement', 'A refund is linked to this movement: delete the refund first')
  await deleteMovementRow(tx, userId, id)
  if (movement.commitmentId) await resyncFinancing(tx, movement.commitmentId)
}

export async function listMovements(userId: string, filters: MovementFilters = {}): Promise<Movement[]> {
  return await listMovementsDs(db(), userId, filters)
}

/** What the current filter selects, in one row: count and per-kind totals. */
export async function selectionTotals(
  userId: string,
  filters: MovementFilters = {},
): Promise<MovementSelection> {
  return await selectionTotalsDs(db(), userId, filters)
}

export async function outstandingAdvances(userId: string): Promise<(Movement & { refunded: string })[]> {
  return await listOutstandingAdvances(db(), userId)
}

/**
 * The refund arrived: writes the income that closes the claim, in full or in
 * part. Everything it needs is already in the advance, so a caller only says
 * what reality changed, the amount received and the day it landed.
 */
export async function refundAdvance(
  userId: string,
  movementId: string,
  { amount, on }: { amount?: number; on?: string } = {},
): Promise<Movement> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const advance = await getMovement(tx, userId, movementId)
    if (!advance) throw new DomainError('movement_not_found', `No movement ${movementId} for this user`)
    return await writeRefundIn(tx, userId, advance, { amount, on: on ?? today() })
  })
}

/** Writes off what will never come back: the claim stops showing, the expense stays whole. */
export async function closeAdvance(userId: string, movementId: string): Promise<Movement> {
  const sql = db()
  const movement = await getMovement(sql, userId, movementId)
  if (!movement) throw new DomainError('movement_not_found', `No movement ${movementId} for this user`)
  if (!movement.expectedRefundFromActorId)
    throw new DomainError('not_an_advance', 'This movement is not marked as an advance')
  return (await setRefundClosed(sql, userId, movementId, true))!
}
