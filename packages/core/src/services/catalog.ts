import { db } from '../db/client.ts'
import {
  insertActivity,
  insertCategory,
  listActivities as listActivitiesDs,
  listCategories as listCategoriesDs,
} from '../db/datasources/catalog.ts'
import type { Activity, Category } from '../domain/types.ts'

export async function createActivity(userId: string, name: string): Promise<Activity> {
  return await insertActivity(db(), userId, name)
}

export async function listActivities(userId: string): Promise<Activity[]> {
  return await listActivitiesDs(db(), userId)
}

export async function createCategory(
  userId: string,
  name: string,
  groupLabel?: string | null,
): Promise<Category> {
  return await insertCategory(db(), userId, name, groupLabel)
}

export async function listCategories(userId: string): Promise<Category[]> {
  return await listCategoriesDs(db(), userId)
}
