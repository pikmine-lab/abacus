import type { Actor } from '../../domain/types.ts'
import { compact, type Executor } from '../client.ts'

export interface NewActor {
  userId: string
  name: string
  activityId?: string | null
  note?: string | null
}

export async function insertActor(tx: Executor, row: NewActor): Promise<Actor> {
  const [actor] = await tx<Actor[]>`insert into actor ${tx(compact(row))} returning *`
  return actor!
}

export async function getActor(tx: Executor, userId: string, id: string): Promise<Actor | undefined> {
  const [actor] = await tx<Actor[]>`select * from actor where user_id = ${userId} and id = ${id}`
  return actor
}

export async function listActors(tx: Executor, userId: string): Promise<Actor[]> {
  return await tx<Actor[]>`select * from actor where user_id = ${userId} order by name`
}

/** Case-insensitive match on the canonical name or any alias. */
export async function findActorByNameOrAlias(
  tx: Executor,
  userId: string,
  name: string,
): Promise<Actor | undefined> {
  const [actor] = await tx<Actor[]>`
    select a.* from actor a
    where a.user_id = ${userId} and lower(a.name) = lower(${name})
    union
    select a.* from actor a
    join actor_alias al on al.actor_id = a.id
    where al.user_id = ${userId} and lower(al.alias) = lower(${name})
  `
  return actor
}

/** Trigram similarity over names and aliases, best matches first. */
export async function suggestActors(
  tx: Executor,
  userId: string,
  name: string,
  limit = 5,
): Promise<(Actor & { score: number })[]> {
  return await tx<(Actor & { score: number })[]>`
    select a.*,
           greatest(similarity(a.name, ${name}), coalesce(max(similarity(al.alias, ${name})), 0)) as score
    from actor a
    left join actor_alias al on al.actor_id = a.id
    where a.user_id = ${userId}
    group by a.id
    having greatest(similarity(a.name, ${name}), coalesce(max(similarity(al.alias, ${name})), 0)) > 0.3
    order by score desc
    limit ${limit}
  `
}

export async function insertActorAlias(
  tx: Executor,
  userId: string,
  actorId: string,
  alias: string,
): Promise<void> {
  await tx`insert into actor_alias (user_id, actor_id, alias) values (${userId}, ${actorId}, ${alias})`
}

export async function moveAliases(tx: Executor, fromActorId: string, toActorId: string): Promise<void> {
  await tx`update actor_alias set actor_id = ${toActorId} where actor_id = ${fromActorId}`
}

/** Repoints every reference to an actor; used by merge. */
export async function reassignActorReferences(
  tx: Executor,
  fromActorId: string,
  toActorId: string,
): Promise<void> {
  await tx`update movement set source_actor_id = ${toActorId} where source_actor_id = ${fromActorId}`
  await tx`update movement set target_actor_id = ${toActorId} where target_actor_id = ${fromActorId}`
  await tx`update movement set expected_refund_from_actor_id = ${toActorId} where expected_refund_from_actor_id = ${fromActorId}`
  await tx`update commitment set actor_id = ${toActorId} where actor_id = ${fromActorId}`
}

export async function deleteActor(tx: Executor, userId: string, id: string): Promise<void> {
  await tx`delete from actor where user_id = ${userId} and id = ${id}`
}
