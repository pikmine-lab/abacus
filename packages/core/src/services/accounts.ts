import { db } from '../db/client.ts'
import {
  getAccount,
  insertAccount,
  listAccountsWithBalance,
  setAccountClosedOn,
  type NewAccount,
} from '../db/datasources/accounts.ts'
import { DomainError } from '../domain/errors.ts'
import type { Account } from '../domain/types.ts'
import { today } from '../domain/period.ts'

export async function createAccount(input: NewAccount): Promise<Account> {
  return await insertAccount(db(), input)
}

export async function listAccounts(userId: string): Promise<(Account & { balance: string })[]> {
  return await listAccountsWithBalance(db(), userId)
}

/** A closed account keeps its history; it only stops accepting new movements. */
export async function closeAccount(userId: string, id: string, closedOn?: string): Promise<Account> {
  const account = await setAccountClosedOn(db(), userId, id, closedOn ?? today())
  if (!account) throw new DomainError('account_not_found', `No account ${id} for this user`)
  return account
}
