import { type Driver, eur, type Money, type Steps } from '@abacus/use-case-language'
import { closeDb } from '../src/db/client.ts'
import { createAccount, listAccounts } from '../src/services/accounts.ts'
import { createActor, listActors } from '../src/services/actors.ts'
import { declareMovement } from '../src/services/movements.ts'

/**
 * The preparation driver: builds the starting state of a case through the
 * services of the back, as the demo seed does, never through an interface
 * under test nor straight into the tables. When a gesture moves to the API
 * (#192), its step here calls the API instead, and no case changes.
 */

const amountOf = (money: Money) => Number(money.amount)

async function accountId(userId: string, name: string): Promise<string> {
  const account = (await listAccounts(userId)).find((a) => a.name === name)
  if (!account) throw new Error(`no account named "${name}"`)
  return account.id
}

async function actorId(userId: string, name: string): Promise<string> {
  const actor = (await listActors(userId)).find((a) => a.name === name)
  return actor ? actor.id : (await createActor(userId, { name })).id
}

export const preparationDriver: Driver = {
  name: 'preparation',
  async open(user) {
    const steps: Partial<Steps> = {
      async createAccount({ name, opening, openedOn }) {
        await createAccount({
          userId: user.id,
          name,
          behavior: 'payment',
          openingBalance: opening ? amountOf(opening) : undefined,
          openedOn: opening ? (openedOn ?? '2026-01-01') : openedOn,
        })
      },
      async declareExpense({ account, amount, payee, on }) {
        await declareMovement(user.id, {
          happenedOn: on,
          amount: amountOf(amount),
          sourceAccountId: await accountId(user.id, account),
          targetActorId: await actorId(user.id, payee),
        })
      },
      async readAccountBalance(account) {
        const found = (await listAccounts(user.id)).find((a) => a.name === account)
        if (!found) throw new Error(`no account named "${account}"`)
        return eur(Number(found.balance).toFixed(2))
      },
    }
    return { steps, close: async () => {} }
  },
  shutdown: closeDb,
}
