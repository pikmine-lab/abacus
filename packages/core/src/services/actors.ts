import { db } from '../db/client.ts'
import {
  deleteActor,
  findActorByNameOrAlias,
  getActor,
  insertActor,
  insertActorAlias,
  listActors as listActorsDs,
  moveAliases,
  reassignActorReferences,
  suggestActors,
} from '../db/datasources/actors.ts'
import { DomainError } from '../domain/errors.ts'
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
    if ((e as { code?: string }).code === '23505') {
      throw new DomainError('actor_exists', `An actor already uses the name or alias "${input.name}"`)
    }
    throw e
  }
}

export async function listActors(userId: string): Promise<Actor[]> {
  return await listActorsDs(db(), userId)
}

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
    if ((e as { code?: string }).code === '23505') {
      throw new DomainError('alias_taken', `"${alias}" already resolves to an actor`)
    }
    throw e
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
