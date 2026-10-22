import { recordExercised } from '@abacus/use-case-language'
import type { Client } from '@modelcontextprotocol/client'

export type Arguments = Record<string, unknown>

/** A tool that answered with an error: the server refused the call, as opposed to failing to answer. */
export class ToolRefusal extends Error {}

/** What every MCP step module gets: the tools of the server, called as an AI client calls them. */
export interface McpContext {
  /** The address of the MCP endpoint, for what happens before any tool: the access itself. */
  url: string
  /** Calls a tool and answers its JSON; an error reply throws its text as a ToolRefusal. Notes the tool and its action. */
  call<T>(tool: string, args: Arguments): Promise<T>
  /** Calls a batch tool, which answers line by line: a failed line throws its error. */
  batch(tool: string, args: Arguments): Promise<void>
}

export function mcpContext(client: Client, url: string, timeoutMs: number): McpContext {
  async function call<T>(tool: string, args: Arguments): Promise<T> {
    await recordExercised({ driver: 'mcp', name: tool, action: args.action as string | undefined })
    const reply = (await client.callTool({ name: tool, arguments: args }, { timeout: timeoutMs })) as {
      isError?: boolean
      content: { type: string; text: string }[]
    }
    const text = reply.content.map((c) => c.text).join('\n')
    if (reply.isError) throw new ToolRefusal(text)
    return JSON.parse(text) as T
  }
  return {
    url,
    call,
    async batch(tool, args) {
      const { results } = await call<{ results: { ok: boolean; error?: string }[] }>(tool, args)
      const failed = results.find((r) => !r.ok)
      if (failed) throw new Error(failed.error ?? 'refused')
    },
  }
}
