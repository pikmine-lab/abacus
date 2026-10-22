import type { CaseUser, Money } from '@abacus/use-case-language'
import { listAccounts } from '../src/services/accounts.ts'
import { createActor, listActors } from '../src/services/actors.ts'

/** What every preparation step module gets: the case user, and lookups by the names a case uses. */
export interface PreparationContext {
  user: CaseUser
  accountId(name: string): Promise<string>
  /** The actor of that name, created when the user has none yet. */
  actorId(name: string): Promise<string>
  /** The MCP endpoint the suite serves, for what a client of it does. */
  mcpUrl: string
}

export const amountOf = (money: Money) => Number(money.amount)

export function preparationContext(user: CaseUser, mcpUrl: string): PreparationContext {
  return {
    user,
    mcpUrl,
    async accountId(name) {
      const account = (await listAccounts(user.id)).find((a) => a.name === name)
      if (!account) throw new Error(`no account named "${name}"`)
      return account.id
    },
    async actorId(name) {
      const actor = (await listActors(user.id)).find((a) => a.name === name)
      return actor ? actor.id : (await createActor(user.id, { name })).id
    },
  }
}
