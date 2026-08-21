import { db } from '../db/client.ts'
import {
  getCategory,
  insertActivity,
  insertCategory,
  listActivities as listActivitiesDs,
  listCategories as listCategoriesDs,
  updateActivityRow,
  updateCategoryRow,
} from '../db/datasources/catalog.ts'
import { DomainError, rethrowUnique } from '../domain/errors.ts'
import type { Activity, Category } from '../domain/types.ts'

export async function createActivity(userId: string, name: string): Promise<Activity> {
  try {
    return await insertActivity(db(), userId, name)
  } catch (e) {
    rethrowUnique(e, 'activity_exists', `An activity already uses the name "${name}"`)
  }
}

export async function listActivities(userId: string): Promise<Activity[]> {
  return await listActivitiesDs(db(), userId)
}

/**
 * Renames an activity. Nothing has to follow: movements and commitments point
 * at it by id, so what is already filed under it stays filed under it.
 */
export async function editActivity(userId: string, id: string, name: string): Promise<Activity> {
  try {
    const activity = await updateActivityRow(db(), userId, id, name)
    if (!activity) throw new DomainError('activity_not_found', `No activity ${id} for this user`)
    return activity
  } catch (e) {
    rethrowUnique(e, 'activity_exists', `An activity already uses the name "${name}"`)
  }
}

export async function createCategory(
  userId: string,
  name: string,
  groupLabel?: string | null,
): Promise<Category> {
  try {
    return await insertCategory(db(), userId, name, groupLabel)
  } catch (e) {
    rethrowUnique(e, 'category_exists', `A category already uses the name "${name}"`)
  }
}

export async function listCategories(userId: string): Promise<Category[]> {
  return await listCategoriesDs(db(), userId)
}

/** Fields a correction may touch; anything absent keeps its current value. */
export interface CategoryEdit {
  name?: string
  groupLabel?: string | null
}

/** Same as an activity: the references are by id, so a rename propagates itself. */
export async function editCategory(userId: string, id: string, input: CategoryEdit): Promise<Category> {
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.groupLabel !== undefined) patch.groupLabel = input.groupLabel
  const sql = db()
  try {
    const category =
      Object.keys(patch).length > 0
        ? await updateCategoryRow(sql, userId, id, patch)
        : await getCategory(sql, userId, id)
    if (!category) throw new DomainError('category_not_found', `No category ${id} for this user`)
    return category
  } catch (e) {
    rethrowUnique(e, 'category_exists', `A category already uses the name "${input.name}"`)
  }
}
