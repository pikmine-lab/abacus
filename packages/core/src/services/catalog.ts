import { db, type Executor } from '../db/client.ts'
import { getAccount } from '../db/datasources/accounts.ts'
import {
  type ActivityAccount,
  type CategoryException,
  countActivityAccounts,
  countRegimeUses,
  getActivity,
  getCategory,
  insertActivity,
  insertCategory,
  listActivities as listActivitiesDs,
  listActivityAccounts as listActivityAccountsDs,
  listCategories as listCategoriesDs,
  listCategoryExceptions as listCategoryExceptionsDs,
  replaceActivityAccounts,
  replaceCategoryExceptions,
  updateActivityRow,
  updateCategoryRow,
} from '../db/datasources/catalog.ts'
import { DomainError, rethrowUnique } from '../domain/errors.ts'
import { today } from '../domain/period.ts'
import { type SortChoice, type SortFields, sortBy } from '../domain/sort.ts'
import type { Activity, ActivityKind, Category, DeductibleExpenses, RevenueBasis } from '../domain/types.ts'

/**
 * What an activity is declared with. Everything but the name is optional and
 * falls back to the schema's defaults, which describe a `personal` activity:
 * an analysis dimension with no regime, which is exactly what an activity was
 * before it could be a business.
 */
export interface NewActivity {
  name: string
  kind?: ActivityKind
  startedOn?: string | null
  /** The day the fiscal year opens; 1 January unless the regime says otherwise. */
  fiscalYearStartMonth?: number
  fiscalYearStartDay?: number
  /** Which date brings a receipt into the revenue: the payment or the invoice. */
  revenueBasis?: RevenueBasis
  vatRegistered?: boolean
  /** Percent; only with `vatRegistered`. */
  defaultVatRate?: number | null
  deductibleExpenses?: DeductibleExpenses
  /** Free words for the screen; the code never reads them. */
  regimeLabel?: string | null
  currency?: string
  /** The accounts the activity lives on, stated as a whole (see setActivityAccounts). */
  accountIds?: string[]
}

/**
 * A VAT rate says what a registered activity charges: on an activity that is
 * not registered it would be a figure nothing ever reads, and the likeliest
 * sign of a registration forgotten. The schema refuses it too; this says why.
 */
function checkVat(vatRegistered: boolean, defaultVatRate: number | null): void {
  if (defaultVatRate !== null && !vatRegistered)
    throw new DomainError(
      'vat_rate_needs_registration',
      'A default VAT rate only goes with a VAT-registered activity',
    )
  if (defaultVatRate !== null) checkPercent(defaultVatRate)
}

function checkPercent(value: number): void {
  if (!(value >= 0 && value <= 100)) throw new DomainError('bad_rate', `${value} is not a percentage`)
}

/** An activity that closed before it started never existed: the two days are checked together. */
function checkSpan(startedOn: string | null, closedOn: string | null): void {
  if (startedOn && closedOn && closedOn < startedOn)
    throw new DomainError(
      'activity_closes_before_start',
      `An activity cannot close on ${closedOn}, before it started on ${startedOn}`,
    )
}

export async function createActivity(userId: string, input: NewActivity): Promise<Activity> {
  checkVat(input.vatRegistered ?? false, input.defaultVatRate ?? null)
  const { accountIds, ...fields } = input
  const sql = db()
  try {
    return await sql.begin(async (tx) => {
      const activity = await insertActivity(tx, { userId, ...fields })
      if (accountIds) await attachAccounts(tx, userId, activity, accountIds)
      return activity
    })
  } catch (e) {
    rethrowUnique(e, 'activity_exists', `An activity already uses the name "${input.name}"`)
  }
}

export async function listActivities(userId: string): Promise<Activity[]> {
  return await listActivitiesDs(db(), userId)
}

async function requireActivity(tx: Executor, userId: string, id: string): Promise<Activity> {
  const activity = await getActivity(tx, userId, id)
  if (!activity) throw new DomainError('activity_not_found', `No activity ${id} for this user`)
  return activity
}

/** Fields a correction may touch; anything absent keeps its current value. */
export interface ActivityEdit {
  name?: string
  kind?: ActivityKind
  startedOn?: string | null
  fiscalYearStartMonth?: number
  fiscalYearStartDay?: number
  revenueBasis?: RevenueBasis
  vatRegistered?: boolean
  defaultVatRate?: number | null
  deductibleExpenses?: DeductibleExpenses
  regimeLabel?: string | null
  currency?: string
  /** The full list of accounts, replacing the current one; absent leaves it alone. */
  accountIds?: string[]
}

const EDITABLE = [
  'name',
  'kind',
  'startedOn',
  'fiscalYearStartMonth',
  'fiscalYearStartDay',
  'revenueBasis',
  'vatRegistered',
  'defaultVatRate',
  'deductibleExpenses',
  'regimeLabel',
  'currency',
] as const

/**
 * Corrects what an activity says about itself. A rename propagates on its own:
 * movements, commitments and accounts point at it by id.
 *
 * An activity never changes regime. A regime that ends is a closed activity
 * and a new one, so that the statement of one year and the statement of the
 * next each read the rules they were computed with. What decides the regime
 * here is the kind (a personal activity has none) and the revenue basis (which
 * date the rules read a receipt on): both stay correctable while nothing has
 * been built on them, and are refused as soon as a rule or an invoice exists
 * under the activity. The kind is also fixed while accounts are attached, since
 * only a business activity lives on accounts and the treasury they make up.
 */
export async function editActivity(userId: string, id: string, input: ActivityEdit): Promise<Activity> {
  const sql = db()
  try {
    return await sql.begin(async (tx) => {
      const activity = await requireActivity(tx, userId, id)
      // Stated before the guard below reads what is attached, so that one
      // correction may both detach the accounts and make the activity
      // personal, and so that becoming a business and naming its accounts is
      // a single gesture.
      if (input.accountIds)
        await attachAccounts(tx, userId, { ...activity, kind: input.kind ?? activity.kind }, input.accountIds)
      const kindChanges = input.kind !== undefined && input.kind !== activity.kind
      const basisChanges = input.revenueBasis !== undefined && input.revenueBasis !== activity.revenueBasis
      if ((kindChanges || basisChanges) && (await countRegimeUses(tx, id)) > 0)
        throw new DomainError(
          'activity_regime_fixed',
          `Activity "${activity.name}" carries rules or invoices: its regime cannot change. Close it and create the next one`,
        )
      if (kindChanges && (await countActivityAccounts(tx, id)) > 0)
        throw new DomainError(
          'activity_has_accounts',
          `Activity "${activity.name}" lives on accounts, which only a business activity does: let go of them first`,
        )
      checkVat(
        input.vatRegistered ?? activity.vatRegistered,
        input.defaultVatRate !== undefined
          ? input.defaultVatRate
          : activity.defaultVatRate !== null
            ? Number(activity.defaultVatRate)
            : null,
      )
      checkSpan(input.startedOn !== undefined ? input.startedOn : activity.startedOn, activity.closedOn)
      const patch: Record<string, unknown> = {}
      for (const key of EDITABLE) if (input[key] !== undefined) patch[key] = input[key]
      if (Object.keys(patch).length === 0) return activity
      return (await updateActivityRow(tx, userId, id, patch))!
    })
  } catch (e) {
    rethrowUnique(e, 'activity_exists', `An activity already uses the name "${input.name}"`)
  }
}

/**
 * Ends the activity: a movement dated after this day is refused under it, the
 * same way a closed account refuses one. History stays whole, and a regime
 * that changes starts as a new activity from that day.
 */
export async function closeActivity(userId: string, id: string, closedOn?: string): Promise<Activity> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const activity = await requireActivity(tx, userId, id)
    const day = closedOn ?? today()
    checkSpan(activity.startedOn, day)
    return (await updateActivityRow(tx, userId, id, { closedOn: day }))!
  })
}

/** Undoes a close, so closing the wrong activity is not a dead end. */
export async function reopenActivity(userId: string, id: string): Promise<Activity> {
  const activity = await updateActivityRow(db(), userId, id, { closedOn: null })
  if (!activity) throw new DomainError('activity_not_found', `No activity ${id} for this user`)
  return activity
}

/**
 * The categories that go against the activity's deductibility policy: left out
 * when every expense deducts, deductible anyway when none does. Stated as a
 * whole, so a correction says the full list rather than one toggle at a time.
 */
export async function setActivityCategoryExceptions(
  userId: string,
  id: string,
  categoryIds: string[],
): Promise<void> {
  const sql = db()
  await sql.begin(async (tx) => {
    await requireActivity(tx, userId, id)
    const unique = [...new Set(categoryIds)]
    for (const categoryId of unique) {
      if (!(await getCategory(tx, userId, categoryId)))
        throw new DomainError('category_not_found', `No category ${categoryId} for this user`)
    }
    await replaceCategoryExceptions(tx, id, unique)
  })
}

export type { ActivityAccount, CategoryException }

/** Every exception of every activity of the user, for the screens that show them. */
export async function listCategoryExceptions(userId: string): Promise<CategoryException[]> {
  return await listCategoryExceptionsDs(db(), userId)
}

/**
 * What the activity lives on. An account exists before the activities that
 * use it, and several of them may run on the same one: the link is declared
 * here, from the activity, and never from the account.
 *
 * Refused: an account that is not this user's, a closed account (it holds no
 * money the activity could still count on), and any account at all on a
 * personal activity, which is an analysis dimension with no treasury.
 */
async function attachAccounts(
  tx: Executor,
  userId: string,
  activity: Activity,
  accountIds: string[],
): Promise<void> {
  const unique = [...new Set(accountIds)]
  if (unique.length > 0 && activity.kind !== 'business')
    throw new DomainError(
      'activity_not_business',
      `Activity "${activity.name}" is personal: only a business activity lives on accounts`,
    )
  for (const accountId of unique) {
    const account = await getAccount(tx, userId, accountId)
    if (!account) throw new DomainError('account_not_found', `No account ${accountId} for this user`)
    if (account.closedOn)
      throw new DomainError(
        'account_closed',
        `Account "${account.name}" is closed since ${account.closedOn}: an activity does not start living on it`,
      )
  }
  await replaceActivityAccounts(tx, activity.id, unique)
}

/** Stated as a whole, so a correction says the full list rather than one link at a time. */
export async function setActivityAccounts(userId: string, id: string, accountIds: string[]): Promise<void> {
  const sql = db()
  await sql.begin(async (tx) => {
    const activity = await requireActivity(tx, userId, id)
    await attachAccounts(tx, userId, activity, accountIds)
  })
}

/** Every link of every activity of the user, for the screens that show them. */
export async function listActivityAccounts(userId: string): Promise<ActivityAccount[]> {
  return await listActivityAccountsDs(db(), userId)
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

/**
 * What the vocabulary lists offer to be ordered on. A category opens grouped,
 * the order it is read in when checking what is filed where; an activity has
 * its name and nothing else to rank on, and the criterion still exists so the
 * reversal does.
 */
export type CategorySortField = 'name' | 'group'

export const CATEGORY_SORTS: SortFields<CategorySortField> = { name: 'asc', group: 'asc' }

export const DEFAULT_CATEGORY_SORT: SortChoice<CategorySortField> = { field: 'group', direction: 'asc' }

export function sortCategories(
  categories: Category[],
  sort: SortChoice<CategorySortField> = DEFAULT_CATEGORY_SORT,
): Category[] {
  if (sort.field === 'name') return sortBy(categories, (c) => c.name, sort.direction)
  // Grouped, then alphabetical inside a group: a group with a single category
  // would otherwise land wherever the previous order left it.
  return sortBy(
    sortBy(categories, (c) => c.name, 'asc'),
    (c) => c.groupLabel,
    sort.direction,
  )
}

export type NameSortField = 'name'

export const NAME_SORTS: SortFields<NameSortField> = { name: 'asc' }

export const DEFAULT_NAME_SORT: SortChoice<NameSortField> = { field: 'name', direction: 'asc' }

/** Activities and actors rank on their name alone, which is all their row shows. */
export function sortByName<T extends { name: string }>(
  entries: T[],
  sort: SortChoice<NameSortField> = DEFAULT_NAME_SORT,
): T[] {
  return sortBy(entries, (entry) => entry.name, sort.direction)
}
