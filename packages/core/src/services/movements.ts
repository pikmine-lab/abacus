import { db, type Executor } from '../db/client.ts'
import { getAccount } from '../db/datasources/accounts.ts'
import { getActor } from '../db/datasources/actors.ts'
import {
  getMovement,
  insertMovement,
  listMovements as listMovementsDs,
  listOutstandingAdvances,
  type MovementFilters,
  setRefundClosed,
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
  const activityId = input.activityId !== undefined ? input.activityId : (externalActor?.activityId ?? null)

  return await insertMovement(tx, { ...input, userId, activityId })
}

export async function declareMovement(userId: string, input: DeclareMovementInput): Promise<Movement> {
  const sql = db()
  return await sql.begin(async (tx) => declareMovementIn(tx, userId, input))
}

export async function listMovements(userId: string, filters: MovementFilters = {}): Promise<Movement[]> {
  return await listMovementsDs(db(), userId, filters)
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
