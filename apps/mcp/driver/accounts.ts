import { eur, type Steps } from '@abacus/use-case-language'
import type { McpContext } from './context.ts'

export function accountsSteps({ call }: McpContext): Partial<Steps> {
  return {
    async createAccount({ name, opening, openedOn }) {
      await call('manage_accounts', {
        action: 'create',
        name,
        behavior: 'payment',
        openingBalance: opening ? Number(opening.amount) : undefined,
        openedOn: opening ? (openedOn ?? '2026-01-01') : openedOn,
      })
    },
    async readAccountBalance(account) {
      const { accounts } = await call<{ accounts: { name: string; balance: number }[] }>('manage_accounts', {
        action: 'list',
      })
      const found = accounts.find((a) => a.name === account)
      if (!found) throw new Error(`no account named "${account}"`)
      return eur(found.balance.toFixed(2))
    },
  }
}
