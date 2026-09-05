import type { Activity, Category } from '../../domain/types.ts'
import { compact, type Executor } from '../client.ts'

/** Absent fields take the column defaults, which are the defaults of the domain. */
export interface NewActivityRow {
  userId: string
  name: string
  kind?: Activity['kind']
  startedOn?: string | null
  fiscalYearStartMonth?: number
  fiscalYearStartDay?: number
  revenueBasis?: Activity['revenueBasis']
  vatRegistered?: boolean
  defaultVatRate?: number | null
  deductibleExpenses?: Activity['deductibleExpenses']
  regimeLabel?: string | null
  currency?: string
}

export async function insertActivity(tx: Executor, row: NewActivityRow): Promise<Activity> {
  const [activity] = await tx<Activity[]>`insert into activity ${tx(compact(row))} returning *`
  return activity!
}

export async function getActivity(tx: Executor, userId: string, id: string): Promise<Activity | undefined> {
  const [activity] = await tx<Activity[]>`select * from activity where user_id = ${userId} and id = ${id}`
  return activity
}

export async function listActivities(tx: Executor, userId: string): Promise<Activity[]> {
  return await tx<Activity[]>`select * from activity where user_id = ${userId} order by name`
}

/** What ties an activity to its regime: the rules and the invoices written under it. */
export async function countRegimeUses(tx: Executor, activityId: string): Promise<number> {
  const [row] = await tx<{ count: string }[]>`
    select (select count(*) from levy where activity_id = ${activityId})
         + (select count(*) from invoice where activity_id = ${activityId}) as count
  `
  return Number(row!.count)
}

export async function countActivityAccounts(tx: Executor, activityId: string): Promise<number> {
  const [row] = await tx<{ count: string }[]>`
    select count(*) as count from account where activity_id = ${activityId}
  `
  return Number(row!.count)
}

export interface CategoryException {
  activityId: string
  categoryId: string
}

export async function listCategoryExceptions(tx: Executor, userId: string): Promise<CategoryException[]> {
  return await tx<CategoryException[]>`
    select e.activity_id, e.category_id
    from activity_category_exception e
    join activity a on a.id = e.activity_id
    where a.user_id = ${userId}
  `
}

export async function replaceCategoryExceptions(
  tx: Executor,
  activityId: string,
  categoryIds: string[],
): Promise<void> {
  await tx`delete from activity_category_exception where activity_id = ${activityId}`
  if (categoryIds.length === 0) return
  await tx`
    insert into activity_category_exception ${tx(categoryIds.map((categoryId) => ({ activityId, categoryId })))}
  `
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
  return await tx<
    Category[]
  >`select * from category where user_id = ${userId} order by group_label nulls last, name`
}

export async function updateActivityRow(
  tx: Executor,
  userId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<Activity | undefined> {
  const [activity] = await tx<Activity[]>`
    update activity set ${tx(patch)}, updated_at = now()
    where user_id = ${userId} and id = ${id}
    returning *
  `
  return activity
}

export async function updateCategoryRow(
  tx: Executor,
  userId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<Category | undefined> {
  const [category] = await tx<Category[]>`
    update category set ${tx(patch)} where user_id = ${userId} and id = ${id} returning *
  `
  return category
}
