import { directsToSignIn, type Steps } from '@abacus/use-case-language'
import { type McpContext, ToolRefusal } from './context.ts'

/** A refusal of the server, as the case reads it; any other failure is not one. */
async function refusedOr(gesture: () => Promise<unknown>): Promise<'corrected' | 'refused'> {
  try {
    await gesture()
    return 'corrected'
  } catch (error) {
    if (error instanceof ToolRefusal) return 'refused'
    throw error
  }
}

export function identitySteps({ url, call }: McpContext): Partial<Steps> {
  return {
    async comeAnonymously() {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
      if (await directsToSignIn(response)) return 'sent-to-sign-in'
      return response.status === 401 ? 'refused' : 'let-in'
    },
    async readConnectedApps() {
      const { connections } = await call<{ connections: { name: string; domain: string | null }[] }>(
        'manage_connections',
        { action: 'list' },
      )
      return connections.map(({ name, domain }) => ({ name, domain }))
    },
    async revokeConnectedApp(name) {
      const { connections } = await call<{ connections: { id: string; name: string }[] }>(
        'manage_connections',
        {
          action: 'list',
        },
      )
      const found = connections.find((c) => c.name === name)
      if (!found) throw new Error(`no connected application named "${name}"`)
      await call('manage_connections', { action: 'revoke', connectionId: found.id })
    },
    async readAccountNames() {
      const { accounts } = await call<{ accounts: { name: string }[] }>('manage_accounts', { action: 'list' })
      return accounts.map((a) => a.name)
    },
    async readMovementCounterparties() {
      const { movements } = await call<{ movements: { counterparty: string }[] }>('list_movements', {})
      return movements.map((m) => m.counterparty)
    },
    async correctSomeoneElsesMovement(movementId, amount) {
      return refusedOr(() =>
        call('fix_movement', { movement: movementId, action: 'correct', amount: Number(amount.amount) }),
      )
    },
    async correctSomeoneElsesCommitment(commitmentId, label) {
      return refusedOr(() => call('update_commitment', { commitment: commitmentId, label }))
    },
  }
}
