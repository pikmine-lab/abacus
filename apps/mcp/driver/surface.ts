import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { buildServer } from '../src/server.ts'

/**
 * What the MCP offers, as the MCP driver names it: every tool, and every value
 * of the `action` field of the tools that have one (`tool · action`), read
 * from the server itself. The inventory guard compares the inventory to it.
 */
export async function mcpSurface(): Promise<{ elements: string[]; tools: string[] }> {
  const handler = createMcpHandler(() => buildServer('surface'))
  const client = new Client({ name: 'abacus-surface', version: '0.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://in-process.surface/mcp'), {
      fetch: (url, init) =>
        handler.fetch(new Request(url, init), {
          authInfo: { token: 'surface', clientId: 'surface', scopes: [], extra: { userId: 'surface' } },
        }),
    }),
  )
  try {
    const { tools } = await client.listTools()
    const elements = tools.flatMap((tool) => {
      const action = (tool.inputSchema.properties as Record<string, { enum?: string[] }> | undefined)?.action
      return action?.enum ? action.enum.map((value) => `${tool.name} · ${value}`) : [tool.name]
    })
    return { elements, tools: tools.map((tool) => tool.name) }
  } finally {
    await client.close()
  }
}
