import { randomBytes } from 'node:crypto'
import { directsToSignIn, eur, type Steps } from '@abacus/use-case-language'
import { DomainError } from '../src/domain/errors.ts'
import { createAccount, listAccounts } from '../src/services/accounts.ts'
import { createActor, listActors } from '../src/services/actors.ts'
import { createSubscription, editCommitment, listCommitments } from '../src/services/commitments.ts'
import { listUserConnections } from '../src/services/connections.ts'
import { correctMovement, declareMovement, listMovements, readMovement } from '../src/services/movements.ts'
import { amountOf, type PreparationContext } from './context.ts'

/** A refusal of the back, as the case reads it; anything else is not one. */
async function refusedOr(gesture: () => Promise<unknown>): Promise<'corrected' | 'refused'> {
  try {
    await gesture()
    return 'corrected'
  } catch (error) {
    if (error instanceof DomainError) return 'refused'
    throw error
  }
}

export function identitySteps({ user, mcpUrl }: PreparationContext): Partial<Steps> {
  // Who the other person of a case is, by what they declared: only the back knows.
  const owners = new Map<string, string>()
  return {
    async someoneElseDeclares({ account, amount, payee, on, subscription }) {
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
      const commitment = await createSubscription(other.id, {
        label: subscription,
        actorId: actor.id,
        accountId: created.id,
        amount: 10,
        periodUnit: 'month',
        firstDueOn: '2026-07-01',
      })
      owners.set(movement.id, other.id)
      return { account, movementId: movement.id, commitmentId: commitment.id }
    },
    async readSomeoneElses({ movementId, commitmentId }) {
      const other = owners.get(movementId)
      if (!other) throw new Error(`no other person declared the movement ${movementId}`)
      const movement = await readMovement(other, movementId)
      const commitment = (await listCommitments(other, false)).find((c) => c.id === commitmentId)
      if (!movement || !commitment) throw new Error('the other person lost what they declared')
      return { amount: eur(movement.amount), commitment: commitment.label }
    },
    async readMovementCounterparties() {
      const names = new Map((await listActors(user.id)).map((a) => [a.id, a.name]))
      const accounts = new Map((await listAccounts(user.id)).map((a) => [a.id, a.name]))
      return (await listMovements(user.id)).map((m) =>
        m.kind === 'transfer'
          ? (accounts.get(m.targetAccountId as string) as string)
          : (names.get((m.sourceActorId ?? m.targetActorId) as string) as string),
      )
    },
    async correctSomeoneElsesMovement(movementId, amount) {
      return refusedOr(() => correctMovement(user.id, movementId, { amount: amountOf(amount) }))
    },
    async correctSomeoneElsesCommitment(commitmentId, label) {
      return refusedOr(() => editCommitment(user.id, commitmentId, { label }))
    },
    async readConnectedApps() {
      return (await listUserConnections(user.id)).map(({ name, domain }) => ({ name, domain }))
    },
    async connectedAppReaches() {
      // A call any MCP client makes first, with the token the case signed in with.
      const response = await fetch(mcpUrl, {
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
      if (response.status !== 401) return 'reaches'
      return (await directsToSignIn(response)) ? 'sent-to-sign-in' : 'refused'
    },
    async readAccountNames() {
      return (await listAccounts(user.id)).map((a) => a.name)
    },
  }
}
