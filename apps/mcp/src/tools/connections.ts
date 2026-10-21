import { listUserConnections, revokeUserConnection } from '@abacus/core/services/connections'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { fail, ok, run } from './shared.ts'

const day = (instant: Date | null) => (instant ? instant.toISOString().slice(0, 10) : null)

export function registerConnectionTools(server: McpServer, userId: string): void {
  server.registerTool(
    'manage_connections',
    {
      description:
        'The AI applications the user let into their account, as the "Connect an AI" screen lists them: each with its name, the domain it comes from (the name alone is self-declared, the domain is not), when it was authorized and when it last renewed its access. Actions: list, revoke. Revoking cuts that application off at once, its very next call refused, and it has to be authorized again in the browser to come back. That includes the application calling this tool: revoking yourself ends this conversation\'s access. Only revoke when the user asks for it, naming the application.',
      inputSchema: z.object({
        action: z.enum(['list', 'revoke']),
        connectionId: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe('revoke: the id of the connection, from list'),
        limit: z.number().int().min(1).max(100).optional().describe('list: how many, 50 by default'),
        offset: z.number().int().min(0).optional().describe('list: how many to skip, for the next page'),
      }),
    },
    async (a) =>
      run(async () => {
        if (a.action === 'list') {
          const connections = await listUserConnections(userId, a.limit ?? 50, a.offset ?? 0)
          return ok({
            connections: connections.map((c) => ({
              id: c.id,
              name: c.name,
              domain: c.domain,
              authorizedOn: day(c.grantedAt),
              lastUsedOn: day(c.lastUsedAt),
            })),
          })
        }
        if (!a.connectionId)
          return fail('Say which connection to revoke: connectionId, from manage_connections list.')
        if (!(await revokeUserConnection(userId, a.connectionId)))
          return fail(
            `No connection ${a.connectionId} for this user: it may already be revoked. List them with manage_connections list.`,
          )
        return ok({ revoked: a.connectionId })
      }),
  )
}
