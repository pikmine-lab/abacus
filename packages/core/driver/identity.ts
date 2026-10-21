import { randomBytes } from 'node:crypto'
import type { Steps } from '@abacus/use-case-language'
import { createAccount, listAccounts } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import { listUserConnections } from '../src/services/connections.ts'
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
    async readConnectedApps() {
      return (await listUserConnections(user.id)).map(({ name, domain }) => ({ name, domain }))
    },
    async connectedAppReaches() {
      // A call any MCP client makes first, with the token the case signed in with.
      const response = await fetch(process.env.ABACUS_CASES_MCP_URL as string, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${user.accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'probe', version: '0' },
          },
        }),
      })
      return response.status !== 401
    },
    async readAccountNames() {
      return (await listAccounts(user.id)).map((a) => a.name)
    },
  }
}
