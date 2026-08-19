import type { Account } from '../../domain/types.ts'
import { compact, type Executor } from '../client.ts'

export interface NewAccount {
  userId: string
  name: string
  institution?: string | null
  behavior: Account['behavior']
  currency?: string
  openedOn?: string | null
}

export async function insertAccount(tx: Executor, row: NewAccount): Promise<Account> {
  const [account] = await tx<Account[]>`insert into account ${tx(compact(row))} returning *`
  return account!
}

export async function getAccount(tx: Executor, userId: string, id: string): Promise<Account | undefined> {
  const [account] = await tx<Account[]>`select * from account where user_id = ${userId} and id = ${id}`
  return account
}

export async function listAccounts(tx: Executor, userId: string): Promise<Account[]> {
  return await tx<Account[]>`select * from account where user_id = ${userId} order by name`
}

export async function listAccountsWithBalance(
  tx: Executor,
  userId: string,
): Promise<(Account & { balance: string })[]> {
  return await tx<(Account & { balance: string })[]>`
    select a.*, coalesce(b.balance, 0)::numeric(14,2) as balance
    from account a
    left join lateral (
      select sum(case when m.target_account_id = a.id then m.amount else -m.amount end) as balance
      from movement m
      where m.source_account_id = a.id or m.target_account_id = a.id
    ) b on true
    where a.user_id = ${userId}
    order by a.name
  `
}

export async function setAccountClosedOn(
  tx: Executor,
  userId: string,
  id: string,
  closedOn: string | null,
): Promise<Account | undefined> {
  const [account] = await tx<Account[]>`
    update account set closed_on = ${closedOn}, updated_at = now()
    where user_id = ${userId} and id = ${id}
    returning *
  `
  return account
}
