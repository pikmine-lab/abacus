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
    select a.*, (coalesce(m.delta, 0) + coalesce(o.delta, 0))::numeric(14,2) as balance
    from account a
    left join lateral (
      select sum(case when mv.target_account_id = a.id then mv.amount else -mv.amount end) as delta
      from movement mv
      where mv.source_account_id = a.id or mv.target_account_id = a.id
    ) m on true
    -- Operations move the cash inside an investment account: buying and paying
    -- fees take money out, selling and dividends put it back. Counting only
    -- movements would make that cash wrong from the first purchase on, and an
    -- investment account's balance is its cash, its holdings being valued apart.
    left join lateral (
      select sum(case when op.type in ('sell', 'dividend') then op.amount else -op.amount end) as delta
      from investment_operation op
      where op.account_id = a.id
    ) o on true
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

export async function updateAccountRow(
  tx: Executor,
  userId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<Account | undefined> {
  const [account] = await tx<Account[]>`
    update account set ${tx(patch)}, updated_at = now()
    where user_id = ${userId} and id = ${id}
    returning *
  `
  return account
}

/** What makes an investment account's behavior irreversible. */
export async function countInvestmentOperations(tx: Executor, accountId: string): Promise<number> {
  const [row] = await tx<{ count: string }[]>`
    select count(*) as count from investment_operation where account_id = ${accountId}
  `
  return Number(row!.count)
}
