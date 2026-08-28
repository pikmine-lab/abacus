import { db } from '../db/client.ts'
import {
  countInvestmentOperations,
  getAccount,
  insertAccount,
  listAccountsWithBalance,
  type NewAccount,
  setAccountClosedOn,
  updateAccountRow,
} from '../db/datasources/accounts.ts'
import { DomainError, rethrowUnique } from '../domain/errors.ts'
import { today } from '../domain/period.ts'
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

export async function createAccount(input: NewAccount): Promise<Account> {
  checkOpening(input.openingBalance, input.openedOn)
  try {
    return await insertAccount(db(), input)
  } catch (e) {
    rethrowUnique(e, 'account_exists', `An account already uses the name "${input.name}"`)
  }
}

export async function listAccounts(userId: string): Promise<(Account & { balance: string })[]> {
  return await listAccountsWithBalance(db(), userId)
}

/** Fields a correction may touch; anything absent keeps its current value. */
export interface AccountEdit {
  name?: string
  institution?: string | null
  behavior?: AccountBehavior
  /** What the account already held, and the day it held it: both correctable. */
  openingBalance?: number
  openedOn?: string | null
}

const EDITABLE = ['name', 'institution', 'behavior', 'openingBalance', 'openedOn'] as const

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
