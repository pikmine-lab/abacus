import { db, type Executor } from '../db/client.ts'
import {
  countInvestmentOperations,
  getAccount,
  insertAccount,
  listAccountsWithBalance,
  type NewAccount,
  setAccountClosedOn,
  updateAccountRow,
} from '../db/datasources/accounts.ts'
import { getActivity } from '../db/datasources/catalog.ts'
import { DomainError, rethrowUnique } from '../domain/errors.ts'
import { today } from '../domain/period.ts'
import { type SortChoice, type SortFields, sortBy } from '../domain/sort.ts'
import type { Account, AccountBehavior } from '../domain/types.ts'

/**
 * An account is declared with the money it already holds: its opening balance,
 * what was there before anything was typed in. That money is not a movement,
 * it has no counterparty and no category, and no analysis of flows ever counts
 * it; only balances do, from the day the account opened.
 *
 * That day is what an opening is stated against, so a non-zero one is refused
 * without it: it says when the account enters the balances, and a check dated
 * earlier has nothing to compare against. Negative is fine, an account can be
 * taken over overdrawn.
 */
function checkOpening(openingBalance: number | undefined, openedOn: string | null | undefined): void {
  if (openingBalance !== undefined && openingBalance !== 0 && !openedOn)
    throw new DomainError(
      'opening_needs_its_day',
      'An opening balance needs the day the account opened: that is the day it starts counting',
    )
}

/**
 * An account belongs to a business activity or to nobody: its balance is then
 * the activity's treasury, and a transfer out of it toward an account with no
 * activity is the owner paying themselves. A personal activity owns nothing,
 * it is an analysis dimension, so attaching an account to one is refused.
 */
async function checkActivity(
  tx: Executor,
  userId: string,
  activityId: string | null | undefined,
): Promise<void> {
  if (!activityId) return
  const activity = await getActivity(tx, userId, activityId)
  if (!activity) throw new DomainError('activity_not_found', `No activity ${activityId} for this user`)
  if (activity.kind !== 'business')
    throw new DomainError(
      'activity_not_business',
      `Activity "${activity.name}" is personal: only a business activity owns accounts`,
    )
}

export async function createAccount(input: NewAccount): Promise<Account> {
  checkOpening(input.openingBalance, input.openedOn)
  const sql = db()
  await checkActivity(sql, input.userId, input.activityId)
  try {
    return await insertAccount(sql, input)
  } catch (e) {
    rethrowUnique(e, 'account_exists', `An account already uses the name "${input.name}"`)
  }
}

export async function listAccounts(userId: string): Promise<(Account & { balance: string })[]> {
  return await listAccountsWithBalance(db(), userId)
}

/**
 * What a list of accounts offers to be ordered on. The name is the default:
 * an account is looked up before it is compared, and the lists are grouped by
 * behavior anyway, so the ranking runs inside each group.
 */
export type AccountSortField = 'name' | 'balance' | 'checked'

export const ACCOUNT_SORTS: SortFields<AccountSortField> = {
  name: 'asc',
  balance: 'desc',
  // Oldest check first: this criterion is read to find what to point next.
  checked: 'asc',
}

export const DEFAULT_ACCOUNT_SORT: SortChoice<AccountSortField> = { field: 'name', direction: 'asc' }

/** One account and the day it was last pointed, which is what "checked" ranks on. */
export interface CheckedAccount {
  account: Account & { balance: string }
  lastCheckedOn: string | null
}

export function sortAccounts<T extends CheckedAccount>(
  items: T[],
  sort: SortChoice<AccountSortField> = DEFAULT_ACCOUNT_SORT,
): T[] {
  return sortBy(
    items,
    (item) =>
      sort.field === 'balance'
        ? Number(item.account.balance)
        : // Never pointed is not a missing value: it is the oldest a check can
          // be, and the account that most needs one. It ranks as such instead
          // of being pushed to the end with what is genuinely unknown.
          sort.field === 'checked'
          ? (item.lastCheckedOn ?? '')
          : item.account.name,
    sort.direction,
  )
}

/** Fields a correction may touch; anything absent keeps its current value. */
export interface AccountEdit {
  name?: string
  institution?: string | null
  behavior?: AccountBehavior
  /** What the account already held, and the day it held it: both correctable. */
  openingBalance?: number
  openedOn?: string | null
  /** The business activity whose money this is; null detaches it. */
  activityId?: string | null
}

const EDITABLE = ['name', 'institution', 'behavior', 'openingBalance', 'openedOn', 'activityId'] as const

/**
 * Corrects what an account says about itself, its behavior and its opening
 * included: an account typed wrongly would otherwise stay wrong forever, since
 * closing it and creating another would mean redeclaring its whole history. An
 * opening read from the wrong statement is the likeliest thing to correct,
 * since every balance of that account descends from it. The behavior stops
 * being correctable once the account carries investment operations, which only
 * that behavior can hold.
 */
export async function editAccount(userId: string, id: string, input: AccountEdit): Promise<Account> {
  const sql = db()
  try {
    return await sql.begin(async (tx) => {
      const account = await getAccount(tx, userId, id)
      if (!account) throw new DomainError('account_not_found', `No account ${id} for this user`)
      if (input.behavior && input.behavior !== account.behavior) {
        if ((await countInvestmentOperations(tx, id)) > 0)
          throw new DomainError(
            'account_has_operations',
            `Account "${account.name}" carries investment operations: its behavior cannot change`,
          )
      }
      // Correcting one of the two says nothing about the other: the stored one
      // is what the correction lands on.
      checkOpening(
        input.openingBalance ?? Number(account.openingBalance),
        input.openedOn !== undefined ? input.openedOn : account.openedOn,
      )
      await checkActivity(tx, userId, input.activityId)
      const patch: Record<string, unknown> = {}
      for (const key of EDITABLE) if (input[key] !== undefined) patch[key] = input[key]
      if (Object.keys(patch).length === 0) return account
      return (await updateAccountRow(tx, userId, id, patch))!
    })
  } catch (e) {
    rethrowUnique(e, 'account_exists', `An account already uses the name "${input.name}"`)
  }
}

/** A closed account keeps its history; it only stops accepting new movements. */
export async function closeAccount(userId: string, id: string, closedOn?: string): Promise<Account> {
  const account = await setAccountClosedOn(db(), userId, id, closedOn ?? today())
  if (!account) throw new DomainError('account_not_found', `No account ${id} for this user`)
  return account
}

/** Undoes a close, so closing the wrong account is not a dead end. */
export async function reopenAccount(userId: string, id: string): Promise<Account> {
  const account = await setAccountClosedOn(db(), userId, id, null)
  if (!account) throw new DomainError('account_not_found', `No account ${id} for this user`)
  return account
}
