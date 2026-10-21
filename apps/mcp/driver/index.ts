import { type Driver, eur, recordExercised, type Steps } from '@abacus/use-case-language'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

/**
 * The MCP driver: plays each step through the MCP server the suite serves, over
 * its HTTP transport, with the case user's access token, as an AI client would.
 * Every tool it calls is noted with its action, for the coverage guards.
 */

type Arguments = Record<string, unknown>

export function mcpDriver(mcpUrl: string): Driver {
  return {
    name: 'mcp',
    async open(user) {
      const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
        requestInit: { headers: { authorization: `Bearer ${user.accessToken}` } },
      })
      const client = new Client({ name: 'abacus-use-cases', version: '0.0.0' })
      await client.connect(transport)

      async function call<T>(tool: string, args: Arguments): Promise<T> {
        await recordExercised({ driver: 'mcp', name: tool, action: args.action as string | undefined })
        const reply = (await client.callTool({ name: tool, arguments: args })) as {
          isError?: boolean
          content: { type: string; text: string }[]
        }
        const text = reply.content.map((c) => c.text).join('\n')
        if (reply.isError) throw new Error(text)
        return JSON.parse(text) as T
      }

      /** A batch tool answers line by line: a failed line is a refusal. */
      async function batch(tool: string, args: Arguments): Promise<void> {
        const { results } = await call<{ results: { ok: boolean; error?: string }[] }>(tool, args)
        const failed = results.find((r) => !r.ok)
        if (failed) throw new Error(failed.error ?? 'refused')
      }

      const steps: Partial<Steps> = {
        async createAccount({ name, opening, openedOn }) {
          await call('manage_accounts', {
            action: 'create',
            name,
            behavior: 'payment',
            openingBalance: opening ? Number(opening.amount) : undefined,
            openedOn: opening ? (openedOn ?? '2026-01-01') : openedOn,
          })
        },
        async declareExpense({ account, amount, payee, on }) {
          // The person names the payee on purpose: it is created if new.
          await batch('declare_movements', {
            movements: [{ type: 'expense', date: on, amount: Number(amount.amount), account, actor: payee }],
            createUnknownActors: true,
          })
        },
        async readAccountBalance(account) {
          const { accounts } = await call<{ accounts: { name: string; balance: number }[] }>(
            'manage_accounts',
            {
              action: 'list',
            },
          )
          const found = accounts.find((a) => a.name === account)
          if (!found) throw new Error(`no account named "${account}"`)
          return eur(found.balance.toFixed(2))
        },
      }
      return { steps, close: () => client.close() }
    },
  }
}
