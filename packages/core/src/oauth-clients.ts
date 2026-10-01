import type {
  ClientDiscovery,
  OAuthClient,
  OAuthOptions,
  SchemaClient,
  Scope,
} from '@better-auth/oauth-provider'
import { registerClientMetadataDocument } from '@better-auth/oauth-provider/internal'
import { PREREGISTERED_CLIENT_IDS } from './oauth.ts'

/**
 * AI clients that publish no metadata document and expect a fixed client_id,
 * pasted by the user into their MCP configuration. Each is a public client of
 * its own, never shared: consent binds to the client_id, so a common one would
 * extend to every assistant the access granted to one.
 *
 * What a client declares (its redirect URIs above all) is a public fact about
 * a product, not a choice of ours: it ships here as data, with where it was
 * read and when, and is checked again when a client stops connecting.
 */
export interface PreregisteredClient {
  clientId: string
  metadata: Omit<OAuthClient, 'client_id'>
  /** Where the redirect URIs were read. */
  source: string
  /** When they were last checked against that source (YYYY-MM-DD). */
  checkedOn: string
}

const PUBLIC_CODE_FLOW: Pick<OAuthClient, 'grant_types' | 'response_types' | 'token_endpoint_auth_method'> = {
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
}

export const PREREGISTERED_CLIENTS: PreregisteredClient[] = [
  {
    clientId: PREREGISTERED_CLIENT_IDS.cursor,
    metadata: {
      ...PUBLIC_CODE_FLOW,
      client_name: 'Cursor',
      client_uri: 'https://cursor.com',
      // The desktop app listens on a fixed loopback port (on [::1] only, hence
      // localhost and not 127.0.0.1); the web app and cloud agents come back
      // through cursor.com. The cursor:// fallback the desktop app sometimes
      // uses has a naming authority, which a native redirect may not carry.
      redirect_uris: ['http://localhost:8787/callback', 'https://www.cursor.com/agents/mcp/oauth/callback'],
      application_type: 'native',
    },
    source: 'https://cursor.com/docs/context/mcp',
    checkedOn: '2026-10-01',
  },
  {
    clientId: PREREGISTERED_CLIENT_IDS.microsoft365Copilot,
    metadata: {
      ...PUBLIC_CODE_FLOW,
      client_name: 'Microsoft 365 Copilot',
      client_uri: 'https://www.microsoft.com/microsoft-365/copilot',
      // One redirect for every agent and provider. The client_id is entered
      // by whoever builds the agent (Agents Toolkit or the Teams developer
      // portal), not by the person who chats with it.
      redirect_uris: ['https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect'],
      application_type: 'web',
    },
    source:
      'https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-authentication-oauth',
    checkedOn: '2026-10-01',
  },
]

const DISCOVERY_ID = 'preregistered'

/**
 * Materializes a pre-registered client on first use, through the same seam
 * metadata-document clients go through: the row is created with the chosen
 * client_id and linked to the MCP resource in one transaction, so nothing has
 * to run at deploy time, before or after the migrations. The first resolution
 * in a process rewrites the row from the data above, so a corrected redirect
 * URI ships with the code that carries it.
 */
export function preregisteredClientDiscovery(clients: readonly PreregisteredClient[]): ClientDiscovery {
  const byId = new Map(clients.map((c) => [c.clientId, c]))
  const synced = new Set<string>()
  return {
    id: DISCOVERY_ID,
    matches: (clientId) => byId.has(clientId),
    resolve: async (ctx, clientId, existing) => {
      const client = byId.get(clientId)
      if (!client) return null
      if (existing && synced.has(clientId)) return existing
      const provider = ctx.context.getPlugin('oauth-provider') as { options: OAuthOptions<Scope[]> } | null
      if (!provider) return null
      const result = await registerClientMetadataDocument(ctx, provider.options, {
        clientId,
        clientDiscoveryId: DISCOVERY_ID,
        metadata: { ...client.metadata, client_id: clientId },
        existingClient: (existing ?? undefined) as SchemaClient<Scope[]> | undefined,
      })
      synced.add(clientId)
      return result.client
    },
  }
}
