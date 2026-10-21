import { eur, type Steps } from '@abacus/use-case-language'
import { createAccount, listAccounts } from '../src/services/accounts.ts'
import { amountOf, type PreparationContext } from './context.ts'

export function accountsSteps({ user }: PreparationContext): Partial<Steps> {
  return {
    async createAccount({ name, opening, openedOn }) {
      await createAccount({
        userId: user.id,
        name,
        behavior: 'payment',
        openingBalance: opening ? amountOf(opening) : undefined,
        openedOn: opening ? (openedOn ?? '2026-01-01') : openedOn,
      })
    },
    async readAccountBalance(account) {
      const found = (await listAccounts(user.id)).find((a) => a.name === account)
      if (!found) throw new Error(`no account named "${account}"`)
      return eur(Number(found.balance).toFixed(2))
    },
  }
}
