import type { ActivityInput, Levy, LevyModifier, Threshold } from '../../domain/types.ts'
import { compact, type Executor } from '../client.ts'

/**
 * Rows of 0018, written here and nowhere else. The JSON columns travel as
 * documents the service already validated (domain/levy.ts); this layer only
 * knows which columns are jsonb, so the driver sends them as such rather than
 * guessing an array type from a list of objects.
 */

const LEVY_JSON = [
  'baseAbatement',
  'baseCredits',
  'brackets',
  'elective',
  'due',
  'skipPeriods',
  'regularizationParams',
] as const

/** Wraps the jsonb values of a row for the driver; null stays SQL null. */
function withJson(tx: Executor, row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row }
  for (const key of LEVY_JSON) {
    if (out[key] !== undefined && out[key] !== null) out[key] = tx.json(out[key] as never)
  }
  return out
}

export async function insertLevy(tx: Executor, row: Record<string, unknown>): Promise<Levy> {
  const [levy] = await tx<Levy[]>`insert into levy ${tx(withJson(tx, compact(row)))} returning *`
  return levy!
}

export async function getLevy(tx: Executor, userId: string, id: string): Promise<Levy | undefined> {
  const [levy] = await tx<Levy[]>`select * from levy where user_id = ${userId} and id = ${id}`
  return levy
}

/**
 * The rules of an activity, oldest validity first within a name so the
 * successive versions of one rule read as a history. `at` keeps only the rows
 * in force that day.
 */
export async function listLevies(
  tx: Executor,
  userId: string,
  activityId: string,
  at?: string,
): Promise<Levy[]> {
  return await tx<Levy[]>`
    select * from levy
    where user_id = ${userId} and activity_id = ${activityId}
    ${at ? tx`and valid_from <= ${at} and (valid_to is null or valid_to >= ${at})` : tx``}
    order by name, valid_from
  `
}

export async function updateLevyRow(
  tx: Executor,
  userId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<Levy | undefined> {
  const [levy] = await tx<Levy[]>`
    update levy set ${tx(withJson(tx, patch))}, updated_at = now()
    where user_id = ${userId} and id = ${id}
    returning *
  `
  return levy
}

export async function deleteLevyRow(tx: Executor, userId: string, id: string): Promise<void> {
  await tx`delete from levy where user_id = ${userId} and id = ${id}`
}

/** The other rules that read this one as their base, add-back or credit. */
export async function countLevyReferences(tx: Executor, levyId: string): Promise<number> {
  const [row] = await tx<{ count: string }[]>`
    select count(*) as count from levy
    where id <> ${levyId}
      and (base_levy_id = ${levyId}
        or ${levyId}::uuid = any(coalesce(base_add_back_levy_ids, '{}'))
        or exists (
          select 1 from jsonb_array_elements(coalesce(base_credits, '[]'::jsonb)) c
          where c->>'levyId' = ${levyId}
        ))
  `
  return Number(row!.count)
}

/**
 * The rules of the activity already filing their settlements in a category
 * over a validity that overlaps the given one, `exceptId` (the row being
 * corrected) apart. Two of them would each read the other's payments.
 */
export async function leviesSharingSettlementCategory(
  tx: Executor,
  activityId: string,
  categoryId: string,
  validFrom: string,
  validTo: string | null,
  exceptId?: string,
): Promise<Levy[]> {
  return await tx<Levy[]>`
    select * from levy
    where activity_id = ${activityId} and settlement_category_id = ${categoryId}
      and (${exceptId ?? null}::uuid is null or id <> ${exceptId ?? null})
      and valid_from <= coalesce(${validTo}::date, 'infinity')
      and coalesce(valid_to, 'infinity') >= ${validFrom}::date
    order by valid_from
  `
}

/**
 * The expenses of the activity filed in a category over a window: what settles
 * a rule, and what makes it part of the history once one exists.
 */
export async function countSettlements(
  tx: Executor,
  activityId: string,
  categoryId: string,
  from: string,
  to: string | null,
): Promise<number> {
  const [row] = await tx<{ count: string }[]>`
    select count(*) as count from movement
    where activity_id = ${activityId} and category_id = ${categoryId} and kind = 'expense'
      and happened_on >= ${from} and (${to}::date is null or happened_on <= ${to})
  `
  return Number(row!.count)
}

export async function insertModifier(tx: Executor, row: Record<string, unknown>): Promise<LevyModifier> {
  const [modifier] = await tx<LevyModifier[]>`insert into levy_modifier ${tx(compact(row))} returning *`
  return modifier!
}

/** A modifier has no owner column: it belongs to whoever owns its rule. */
export async function getModifier(
  tx: Executor,
  userId: string,
  id: string,
): Promise<(LevyModifier & { activityId: string }) | undefined> {
  const [modifier] = await tx<(LevyModifier & { activityId: string })[]>`
    select m.*, l.activity_id from levy_modifier m join levy l on l.id = m.levy_id
    where l.user_id = ${userId} and m.id = ${id}
  `
  return modifier
}

export async function listModifiers(tx: Executor, levyIds: string[]): Promise<LevyModifier[]> {
  if (levyIds.length === 0) return []
  return await tx<LevyModifier[]>`
    select * from levy_modifier where levy_id in ${tx(levyIds)} order by starts_on nulls first, created_at
  `
}

export async function updateModifierRow(
  tx: Executor,
  id: string,
  patch: Record<string, unknown>,
): Promise<LevyModifier | undefined> {
  const [modifier] = await tx<LevyModifier[]>`
    update levy_modifier set ${tx(patch)} where id = ${id} returning *
  `
  return modifier
}

export async function deleteModifierRow(tx: Executor, id: string): Promise<void> {
  await tx`delete from levy_modifier where id = ${id}`
}

/**
 * A figure stated for a name from a date: restating the same day replaces the
 * value, since two figures for one day would leave the engine to pick.
 */
export async function upsertInput(
  tx: Executor,
  row: {
    userId: string
    activityId: string
    name: string
    validFrom: string
    value: number
    note: string | null
  },
): Promise<ActivityInput> {
  const [input] = await tx<ActivityInput[]>`
    insert into activity_input ${tx(row)}
    on conflict (activity_id, name, valid_from) do update set value = excluded.value, note = excluded.note
    returning *
  `
  return input!
}

export async function getInput(tx: Executor, userId: string, id: string): Promise<ActivityInput | undefined> {
  const [input] = await tx<ActivityInput[]>`
    select * from activity_input where user_id = ${userId} and id = ${id}
  `
  return input
}

export async function listInputs(tx: Executor, userId: string, activityId: string): Promise<ActivityInput[]> {
  return await tx<ActivityInput[]>`
    select * from activity_input where user_id = ${userId} and activity_id = ${activityId}
    order by name, valid_from desc
  `
}

/** The value in force at a date: the latest one stated on or before it. */
export async function inputAt(
  tx: Executor,
  userId: string,
  activityId: string,
  name: string,
  at: string,
): Promise<ActivityInput | undefined> {
  const [input] = await tx<ActivityInput[]>`
    select * from activity_input
    where user_id = ${userId} and activity_id = ${activityId} and name = ${name} and valid_from <= ${at}
    order by valid_from desc limit 1
  `
  return input
}

export async function deleteInputRow(tx: Executor, userId: string, id: string): Promise<void> {
  await tx`delete from activity_input where user_id = ${userId} and id = ${id}`
}

export async function insertThreshold(tx: Executor, row: Record<string, unknown>): Promise<Threshold> {
  const [threshold] = await tx<Threshold[]>`insert into threshold ${tx(compact(row))} returning *`
  return threshold!
}

export async function getThreshold(tx: Executor, userId: string, id: string): Promise<Threshold | undefined> {
  const [threshold] = await tx<Threshold[]>`select * from threshold where user_id = ${userId} and id = ${id}`
  return threshold
}

export async function listThresholds(tx: Executor, userId: string, activityId: string): Promise<Threshold[]> {
  return await tx<Threshold[]>`
    select * from threshold where user_id = ${userId} and activity_id = ${activityId} order by label
  `
}

export async function updateThresholdRow(
  tx: Executor,
  userId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<Threshold | undefined> {
  const [threshold] = await tx<Threshold[]>`
    update threshold set ${tx(patch)} where user_id = ${userId} and id = ${id} returning *
  `
  return threshold
}

export async function deleteThresholdRow(tx: Executor, userId: string, id: string): Promise<void> {
  await tx`delete from threshold where user_id = ${userId} and id = ${id}`
}
