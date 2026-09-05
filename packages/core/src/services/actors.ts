import { db } from '../db/client.ts'
import {
  type ActorWithAliases,
  countInheritingMovements,
  deleteActor,
  findActorByNameOrAlias,
  getActor,
  insertActor,
  insertActorAlias,
  listActors as listActorsDs,
  listActorsWithAliases as listActorsWithAliasesDs,
  moveAliases,
  type ReattachScope,
  reassignActorReferences,
  reattachInheritingMovements,
  suggestActors,
  updateActorRow,
} from '../db/datasources/actors.ts'
import { DomainError, rethrowUnique } from '../domain/errors.ts'
import type { Actor } from '../domain/types.ts'

export async function createActor(
  userId: string,
  input: { name: string; aliases?: string[]; activityId?: string | null; note?: string | null },
): Promise<Actor> {
  const sql = db()
  try {
    return await sql.begin(async (tx) => {
      const actor = await insertActor(tx, {
        userId,
        name: input.name,
        activityId: input.activityId ?? null,
        note: input.note ?? null,
      })
      for (const alias of input.aliases ?? []) {
        await insertActorAlias(tx, userId, actor.id, alias)
      }
      return actor
    })
  } catch (e) {
    rethrowUnique(e, 'actor_exists', `An actor already uses the name or alias "${input.name}"`)
  }
}

export async function listActors(userId: string): Promise<Actor[]> {
  return await listActorsDs(db(), userId)
}

/** For the screen that repairs the referential: the aliases come with the actor. */
export async function listActorsWithAliases(userId: string): Promise<ActorWithAliases[]> {
  return await listActorsWithAliasesDs(db(), userId)
}

export type { ActorWithAliases }

export interface ActorResolution {
  match: Actor | null
  /** Close names to disambiguate against before creating a new actor. */
  suggestions: (Actor & { score: number })[]
}

/**
 * The normalization entry point: exact name or alias wins; otherwise close
 * matches are returned so the caller can pick one (and record the queried
 * name as an alias) instead of creating a duplicate.
 */
export async function resolveActor(userId: string, name: string): Promise<ActorResolution> {
  const sql = db()
  const match = await findActorByNameOrAlias(sql, userId, name)
  if (match) return { match, suggestions: [] }
  return { match: null, suggestions: await suggestActors(sql, userId, name) }
}

export async function addAlias(userId: string, actorId: string, alias: string): Promise<void> {
  const sql = db()
  const actor = await getActor(sql, userId, actorId)
  if (!actor) throw new DomainError('actor_not_found', `No actor ${actorId} for this user`)
  try {
    await insertActorAlias(sql, userId, actorId, alias)
  } catch (e) {
    rethrowUnique(e, 'alias_taken', `"${alias}" already resolves to an actor`)
  }
}

/**
 * Absorbs a duplicate: every reference moves to the kept actor and the
 * absorbed name becomes one of its aliases, so the duplicate cannot reappear.
 */
export async function mergeActors(userId: string, keepId: string, absorbedId: string): Promise<Actor> {
  if (keepId === absorbedId) throw new DomainError('merge_self', 'Cannot merge an actor into itself')
  const sql = db()
  return await sql.begin(async (tx) => {
    const keep = await getActor(tx, userId, keepId)
    const absorbed = await getActor(tx, userId, absorbedId)
    if (!keep || !absorbed) throw new DomainError('actor_not_found', 'Both actors must exist for this user')
    await reassignActorReferences(tx, absorbedId, keepId)
    await moveAliases(tx, absorbedId, keepId)
    await deleteActor(tx, userId, absorbedId)
    await insertActorAlias(tx, userId, keepId, absorbed.name)
    return keep
  })
}

/** Fields a correction may touch; anything absent keeps its current value. */
export interface ActorEdit {
  name?: string
  activityId?: string | null
  note?: string | null
}

const EDITABLE = ['name', 'activityId', 'note'] as const

/** What an actor correction hands back: the actor, and what it did not touch. */
export type EditedActor = Actor & {
  /**
   * The past movements still carrying what the actor passed on before (no
   * activity, or its former one) once its activity changed to a new one.
   * Zero otherwise. They are reattached by reattachActorHistory, on request.
   */
  leftBehind: number
}

/**
 * Corrects what an actor says about itself. The former name does not become an
 * alias: a typo has to stop resolving, and a name that really was in use is
 * kept with addAlias, deliberately. The movements already written keep the
 * activity they were written with, as they do everywhere else: attaching a new
 * activity only counts them, so the interfaces can propose the explicit
 * gesture with the number it concerns.
 */
export async function editActor(userId: string, id: string, input: ActorEdit): Promise<EditedActor> {
  const sql = db()
  const patch: Record<string, unknown> = {}
  for (const key of EDITABLE) if (input[key] !== undefined) patch[key] = input[key]
  try {
    return await sql.begin(async (tx) => {
      const current = await getActor(tx, userId, id)
      if (!current) throw new DomainError('actor_not_found', `No actor ${id} for this user`)
      const actor = Object.keys(patch).length > 0 ? (await updateActorRow(tx, userId, id, patch))! : current
      const attached = actor.activityId !== null && actor.activityId !== current.activityId
      const leftBehind = attached
        ? (await countInheritingMovements(tx, userId, id, { previousActivityId: current.activityId })).count
        : 0
      return { ...actor, leftBehind }
    })
  } catch (e) {
    rethrowUnique(e, 'actor_exists', `An actor already uses the name "${input.name}"`)
  }
}

export type { ReattachScope }

export interface ReattachableCount {
  count: number
  /** The day of the oldest movement concerned, when there is one. */
  since: string | null
}

/**
 * The explicit bulk gesture the movement service announces instead of
 * reclassifying history as a side effect: moves the actor's external movements
 * (expenses to it, incomes from it) onto its current activity, when they still
 * carry what it passed on to them.
 *
 * The schema does not record whether a movement's activity was inherited or
 * set on purpose, so the rule reads the values: a movement carrying no
 * activity, or the activity the actor had before the change, was inheriting;
 * one carrying any other activity was set explicitly and is never taken. The
 * former activity is only known at the moment of the change, which is why
 * editActor returns leftBehind and the interfaces propose the gesture right
 * there, naming it. Called later without it, the gesture takes the movements
 * carrying no activity, and nothing else. `from` narrows it to the movements
 * from that day on. One transaction, one update.
 */
export async function reattachActorHistory(
  userId: string,
  actorId: string,
  scope: ReattachScope = {},
): Promise<number> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const actor = await getActor(tx, userId, actorId)
    if (!actor) throw new DomainError('actor_not_found', `No actor ${actorId} for this user`)
    if (!actor.activityId)
      throw new DomainError(
        'actor_has_no_activity',
        `Actor "${actor.name}" has no activity to reattach its history to`,
      )
    return await reattachInheritingMovements(tx, userId, actorId, actor.activityId, inherited(actor, scope))
  })
}

/** How many movements reattachActorHistory would move, with the same scope, and since when. */
export async function countReattachableMovements(
  userId: string,
  actorId: string,
  scope: ReattachScope = {},
): Promise<ReattachableCount> {
  const sql = db()
  const actor = await getActor(sql, userId, actorId)
  if (!actor) throw new DomainError('actor_not_found', `No actor ${actorId} for this user`)
  return await countInheritingMovements(sql, userId, actorId, inherited(actor, scope))
}

/** A former activity that is the current one names nothing left behind. */
function inherited(actor: Actor, scope: ReattachScope): ReattachScope {
  return scope.previousActivityId === actor.activityId ? { from: scope.from } : scope
}
