import { randomBytes } from 'node:crypto'
import type { Steps } from '@abacus/use-case-language'
import { createAccount, listAccounts } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import { declareMovement } from '../src/services/movements.ts'
import { amountOf, type PreparationContext } from './context.ts'

export function identitySteps({ user }: PreparationContext): Partial<Steps> {
  return {
    async someoneElseDeclares({ account, amount, payee, on }) {
      // Loaded when used: the auth module needs the suite's addresses to load.
      const { auth } = await import('../src/auth.ts')
      const { user: other } = await auth.api.signUpEmail({
        body: {
          name: 'Dominique',
          email: `other-${randomBytes(6).toString('hex')}@test.local`,
          password: `pw-${randomBytes(12).toString('hex')}`,
        },
      })
      const created = await createAccount({ userId: other.id, name: account, behavior: 'payment' })
      const actor = await createActor(other.id, { name: payee })
      const movement = await declareMovement(other.id, {
        happenedOn: on,
        amount: amountOf(amount),
        sourceAccountId: created.id,
        targetActorId: actor.id,
      })
      return { account, movementId: movement.id }
    },
    async readAccountNames() {
      return (await listAccounts(user.id)).map((a) => a.name)
    },
  }
}
