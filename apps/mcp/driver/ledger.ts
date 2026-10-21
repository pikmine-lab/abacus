import type { Steps } from '@abacus/use-case-language'
import type { McpContext } from './context.ts'

export function ledgerSteps({ batch }: McpContext): Partial<Steps> {
  return {
    async declareExpense({ account, amount, payee, on }) {
      // The person names the payee on purpose: it is created if new.
      await batch('declare_movements', {
        movements: [{ type: 'expense', date: on, amount: Number(amount.amount), account, actor: payee }],
        createUnknownActors: true,
      })
    },
  }
}
