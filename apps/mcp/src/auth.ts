import { authIssuer, MCP_SCOPE } from '@abacus/core/oauth'
import { isConnected } from '@abacus/core/services/connections'
import { createMcpProtectedRequestHandler } from '@better-auth/mcp'
import type { AuthInfo } from '@modelcontextprotocol/server'

/**
 * The MCP server is an OAuth protected resource; the web app is its
 * authorization server, on another domain. An access token is a JWT the web
 * app signed for this exact endpoint: it is verified here against the web
 * app's published keys, and its subject is the user every tool call is scoped
 * to. One query checks the application is still authorized.
 */

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set`)
  return value
}

/**
 * The endpoint as the user types it into a client. Tokens carry it as their
 * audience, so it must match the resource the web app issues tokens for
 * character for character: both read the same MCP_URL.
 */
const resource = required('MCP_URL')
const issuer = authIssuer(required('PUBLIC_URL'))

/**
 * RFC 9728 document a client reads after its first 401, to learn which
 * authorization server to send the user to. The scope is the resource's own:
 * offline_access belongs to the authorization server, which advertises it.
 */
export const protectedResourceMetadata = {
  resource,
  resource_name: 'abacus',
  authorization_servers: [issuer],
  bearer_methods_supported: ['header'],
  scopes_supported: [MCP_SCOPE],
}

/** Where the document is served: the well-known prefix inserted before the endpoint's path. */
export const protectedResourceMetadataPath = `/.well-known/oauth-protected-resource${new URL(resource).pathname}`

/**
 * Wraps a request handler so it only runs with a valid access token. Anything
 * else is answered 401 with the `WWW-Authenticate` challenge pointing at the
 * metadata document: a client reads that header only on a 401, and without it
 * never finds the authorization server.
 */
export function protect(
  handler: (request: Request, authInfo: AuthInfo) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return createMcpProtectedRequestHandler(
    { issuer, audience: resource, jwksUrl: `${issuer}/jwks`, requiredScopes: [MCP_SCOPE] },
    async (request, claims) => {
      const token = request.headers.get('authorization')?.replace(/^\w+\s+/, '') ?? ''
      const clientId = String(claims.client_id ?? claims.azp ?? '')
      // A signature proves the token was issued, not that it still stands:
      // once the user revoked the application, its tokens open nothing more,
      // however long they had left.
      if (!(await isConnected(String(claims.sub), clientId))) return revoked()
      const authInfo: AuthInfo = {
        token,
        clientId,
        scopes: typeof claims.scope === 'string' ? claims.scope.split(' ') : [],
        expiresAt: claims.exp,
        extra: { userId: claims.sub },
      }
      return handler(request, authInfo)
    },
  )
}

/** The same challenge as for a missing token, so a client goes back through authorization. */
function revoked(): Response {
  return Response.json(
    { error: 'invalid_token', error_description: 'This application was disconnected: authorize it again.' },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': `Bearer resource_metadata="${new URL(resource).origin}${protectedResourceMetadataPath}"`,
      },
    },
  )
}

export function userIdOf(authInfo: AuthInfo | undefined): string {
  const userId = (authInfo?.extra as { userId?: string } | undefined)?.userId
  if (!userId) throw new Error('Unauthenticated MCP request reached the server factory')
  return userId
}
