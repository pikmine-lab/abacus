/**
 * What the authorization server (the web app) and the protected resource (the
 * MCP server) must agree on. Kept apart from auth.ts so the MCP server reads
 * it without building a Better Auth instance it has no use for.
 */

/** Where Better Auth is mounted in the web app, and so the path of its issuer. */
export const AUTH_BASE_PATH = '/api/auth'

/**
 * The scope an MCP access token carries. It grants the whole MCP surface: the
 * server has no finer permission to hand out, so a second scope would only be
 * a second word for the same access.
 */
export const MCP_SCOPE = 'mcp'

/**
 * The client_id of each pre-registered client (see oauth-clients.ts), fixed so
 * the screen that hands it out never has to read the database.
 */
export const PREREGISTERED_CLIENT_IDS = {
  cursor: 'cursor',
  microsoft365Copilot: 'microsoft-365-copilot',
} as const

/** The issuer of access tokens: the web app's public URL plus the auth mount. */
export function authIssuer(publicUrl: string): string {
  return `${publicUrl.replace(/\/+$/, '')}${AUTH_BASE_PATH}`
}
