import { auth } from '@abacus/core/auth'
import { type AuthInfo, OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server'

/**
 * The MCP server authenticates with the per-user API keys managed by Better
 * Auth (auth_apikey table). The bearer token IS the API key; a valid key
 * yields the owning user, and every tool call is scoped to that user.
 */
export async function verifyApiKeyToken(token: string): Promise<AuthInfo> {
  const result = await auth.api.verifyApiKey({ body: { key: token } })
  const key = result.key as { userId?: string; referenceId?: string; expiresAt?: Date | null } | null
  const userId = key?.userId ?? key?.referenceId
  if (!result.valid || !userId) {
    // The typed error is what turns into a clean 401; anything else is a 500.
    throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid API key')
  }
  // The bearer gate requires an expiration. API keys may not carry one; the
  // key is re-verified on every request anyway, so a short synthetic window
  // is enough and never caches a revoked key for long.
  const expiresAt = key?.expiresAt
    ? Math.floor(new Date(key.expiresAt).getTime() / 1000)
    : Math.floor(Date.now() / 1000) + 300
  return { token, clientId: userId, scopes: ['mcp'], expiresAt, extra: { userId } }
}

export function userIdOf(authInfo: AuthInfo | undefined): string {
  const userId = (authInfo?.extra as { userId?: string } | undefined)?.userId
  if (!userId) throw new Error('Unauthenticated MCP request reached the server factory')
  return userId
}
