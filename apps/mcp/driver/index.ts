import type { Driver, Steps } from '@abacus/use-case-language'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { accountsSteps } from './accounts.ts'
import { advancesSteps } from './advances.ts'
import { balanceHistorySteps } from './balance-history.ts'
import { businessSteps } from './business.ts'
import { catalogSteps } from './catalog.ts'
import { commitmentsSteps } from './commitments.ts'
import { mcpContext } from './context.ts'

export { mcpSurface } from './surface.ts'

import { identitySteps } from './identity.ts'
import { investmentsSteps } from './investments.ts'
import { ledgerSteps } from './ledger.ts'
import { reportingSteps } from './reporting.ts'
import { venuesSteps } from './venues.ts'

/**
 * The MCP driver: plays each step through the MCP server the suite serves, over
 * its HTTP transport, with the case user's access token, as an AI client would.
 * Every tool it calls is noted with its action, for the coverage guards. The
 * steps live in one module per domain.
 */
export function mcpDriver({ mcpUrl, timeoutMs }: { mcpUrl: string; timeoutMs: number }): Driver {
  return {
    name: 'mcp',
    async open(user) {
      const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
        requestInit: { headers: { authorization: `Bearer ${user.accessToken}` } },
      })
      const client = new Client({ name: 'abacus-use-cases', version: '0.0.0' })
      await client.connect(transport)
      const ctx = mcpContext(client, mcpUrl, timeoutMs)
      const steps: Partial<Steps> = {
        ...ledgerSteps(ctx),
        ...accountsSteps(ctx),
        ...balanceHistorySteps(ctx),
        ...commitmentsSteps(ctx),
        ...advancesSteps(ctx),
        ...businessSteps(ctx),
        ...investmentsSteps(ctx),
        ...venuesSteps(ctx),
        ...catalogSteps(ctx),
        ...reportingSteps(ctx),
        ...identitySteps(ctx),
      }
      return { steps, close: () => client.close() }
    },
  }
}
