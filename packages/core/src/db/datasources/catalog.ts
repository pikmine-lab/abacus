import type { Activity, Category } from '../../domain/types.ts'
import type { Executor } from '../client.ts'

export async function insertActivity(tx: Executor, userId: string, name: string): Promise<Activity> {
  const [activity] = await tx<Activity[]>`
    insert into activity (user_id, name) values (${userId}, ${name}) returning *
  `
  return activity!
}

export async function getActivity(tx: Executor, userId: string, id: string): Promise<Activity | undefined> {
  const [activity] = await tx<Activity[]>`select * from activity where user_id = ${userId} and id = ${id}`
  return activity
}

export async function listActivities(tx: Executor, userId: string): Promise<Activity[]> {
  return await tx<Activity[]>`select * from activity where user_id = ${userId} order by name`
}

export async function insertCategory(
  tx: Executor,
  userId: string,
  name: string,
  groupLabel?: string | null,
): Promise<Category> {
  const [category] = await tx<Category[]>`
    insert into category (user_id, name, group_label)
    values (${userId}, ${name}, ${groupLabel ?? null})
    returning *
  `
  return category!
}

export async function getCategory(tx: Executor, userId: string, id: string): Promise<Category | undefined> {
  const [category] = await tx<Category[]>`select * from category where user_id = ${userId} and id = ${id}`
  return category
}

export async function listCategories(tx: Executor, userId: string): Promise<Category[]> {
  return await tx<Category[]>`select * from category where user_id = ${userId} order by group_label nulls last, name`
}
