import { db, type Executor } from '../db/client.ts'
import { getAccount } from '../db/datasources/accounts.ts'
import { getActor } from '../db/datasources/actors.ts'
import { realignNextDue } from '../db/datasources/installments.ts'
import {
  deleteMovementRow,
  getMovement,
  insertMovement,
  listMovements as listMovementsDs,
  listOutstandingAdvances,
  type MovementFilters,
  type MovementSelection,
  selectionTotals as selectionTotalsDs,
  setRefundClosed,
  updateMovementRow,
} from '../db/datasources/movements.ts'
import { DomainError } from '../domain/errors.ts'
import type { Account, Actor, Movement } from '../domain/types.ts'

export interface DeclareMovementInput {
  happenedOn: string
  amount: number
  currency?: string
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
  /** Links this income to the advanced expense it refunds. */
  refundsMovementId?: string
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
 * Transaction-aware variant, so other services (commitment confirmation,
 * balance adjustments) can declare a movement inside their own transaction.
 */
export async function declareMovementIn(
  tx: Executor,
  userId: string,
  input: DeclareMovementInput,
): Promise<Movement> {
  const activityId = await checkMovement(tx, userId, input)
  return await insertMovement(tx, { ...input, userId, activityId })
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

export async function declareMovement(userId: string, input: DeclareMovementInput): Promise<Movement> {
  const sql = db()
  return await sql.begin(async (tx) => declareMovementIn(tx, userId, input))
}

export type { MovementFilters, MovementSelection }

/** Fields a correction may touch; anything absent keeps its current value. */
export interface CorrectMovementInput {
  happenedOn?: string
  amount?: number
  sourceAccountId?: string | null
  sourceActorId?: string | null
  targetAccountId?: string | null
  targetActorId?: string | null
  categoryId?: string | null
  activityId?: string | null
  note?: string | null
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
): Promise<Movement> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const current = await getMovement(tx, userId, id)
    if (!current) throw new DomainError('movement_not_found', `No movement ${id} for this user`)

    const merged: DeclareMovementInput = {
      happenedOn: input.happenedOn ?? current.happenedOn,
      amount: input.amount ?? Number(current.amount),
      sourceAccountId: pick(input, current, 'sourceAccountId'),
      sourceActorId: pick(input, current, 'sourceActorId'),
      targetAccountId: pick(input, current, 'targetAccountId'),
      targetActorId: pick(input, current, 'targetActorId'),
      categoryId: pick(input, current, 'categoryId'),
      note: pick(input, current, 'note'),
      // Explicit null keeps "no activity" from being re-inherited.
      activityId: input.activityId !== undefined ? input.activityId : current.activityId,
      expectedRefundFromActorId: current.expectedRefundFromActorId ?? undefined,
      refundsMovementId: current.refundsMovementId ?? undefined,
    }
    const activityId = await checkMovement(tx, userId, merged)

    const row: Record<string, unknown> = { activityId }
    for (const key of CORRECTABLE) {
      if (key === 'activityId') continue
      row[key] = merged[key] ?? null
    }
    const updated = await updateMovementRow(tx, userId, id, row)
    if (!updated) throw new DomainError('movement_not_found', `No movement ${id} for this user`)
    return updated
  })
}

function pick(
  input: CorrectMovementInput,
  current: Movement,
  key: 'sourceAccountId' | 'sourceActorId' | 'targetAccountId' | 'targetActorId' | 'categoryId' | 'note',
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
  await sql.begin(async (tx) => {
    const movement = await getMovement(tx, userId, id)
    if (!movement) throw new DomainError('movement_not_found', `No movement ${id} for this user`)
    const [refund] = await tx<{ id: string }[]>`
      select id from movement where refunds_movement_id = ${id} limit 1
    `
    if (refund)
      throw new DomainError(
        'refunded_movement',
        'A refund is linked to this movement: delete the refund first',
      )
    await deleteMovementRow(tx, userId, id)
    if (movement.commitmentId) await realignNextDue(tx, movement.commitmentId)
  })
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

/** Writes off what will never come back: the claim stops showing, the expense stays whole. */
export async function closeAdvance(userId: string, movementId: string): Promise<Movement> {
  const sql = db()
  const movement = await getMovement(sql, userId, movementId)
  if (!movement) throw new DomainError('movement_not_found', `No movement ${movementId} for this user`)
  if (!movement.expectedRefundFromActorId)
    throw new DomainError('not_an_advance', 'This movement is not marked as an advance')
  return (await setRefundClosed(sql, userId, movementId, true))!
}
