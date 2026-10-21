import type { Steps } from '@abacus/use-case-language'
import { declareMovement } from '../src/services/movements.ts'
import { amountOf, type PreparationContext } from './context.ts'

export function ledgerSteps({ user, accountId, actorId }: PreparationContext): Partial<Steps> {
  return {
    async declareExpense({ account, amount, payee, on }) {
      await declareMovement(user.id, {
        happenedOn: on,
        amount: amountOf(amount),
        sourceAccountId: await accountId(account),
        targetActorId: await actorId(payee),
      })
    },
  }
}
