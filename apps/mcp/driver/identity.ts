import type { Steps } from '@abacus/use-case-language'
import type { McpContext } from './context.ts'

export function identitySteps({ url, call }: McpContext): Partial<Steps> {
  return {
    async comeAnonymously() {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
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
    async correctSomeoneElsesMovement(movementId, amount) {
      try {
        await call('fix_movement', { movement: movementId, action: 'correct', amount: Number(amount.amount) })
        return 'corrected'
      } catch {
        return 'refused'
      }
    },
  }
}
