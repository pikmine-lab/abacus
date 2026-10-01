import { cimd } from '@better-auth/cimd'
import { fetchClientMetadataResource } from '@better-auth/cimd/node'
import { mcp } from '@better-auth/mcp'
import { betterAuth } from 'better-auth'
import { jwt } from 'better-auth/plugins'
import { Pool } from 'pg'
import { AUTH_BASE_PATH, MCP_SCOPE } from './oauth.ts'
import { PREREGISTERED_CLIENTS, preregisteredClientDiscovery } from './oauth-clients.ts'

/**
 * The MCP endpoint, exactly as the user types it into a client. It is the
 * OAuth resource identifier tokens are bound to, so a single character of
 * difference (a trailing slash, the path) and the client cannot get a token
 * the server accepts.
 */
const mcpResource = process.env.MCP_URL
if (!mcpResource) throw new Error('MCP_URL is not set: every MCP access token is bound to it.')

/**
 * Better Auth owns authentication end to end: users and sessions for the web
 * app, and the OAuth authorization server the MCP server trusts.
 *
 * An AI client never holds a long-lived secret: it identifies itself by the
 * URL of the metadata document it hosts (CIMD), the user signs in and
 * consents here, and the client receives a short access token bound to the
 * MCP endpoint plus a refresh token. Dynamic client registration stays
 * closed: on a public endpoint it is crossed without authentication and adds
 * a client row on every fresh connection. A client that has no metadata
 * document is pre-registered instead (see oauth-clients.ts).
 *
 * Every table is prefixed auth_ because the default names collide with the
 * domain ("account" is a bank account here, not an OAuth account). The schema
 * is not created at runtime: it is generated with `npx auth generate` into a
 * migration and applied by the regular migration runner.
 */
export const auth = betterAuth({
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
  baseURL: process.env.PUBLIC_URL,
  basePath: AUTH_BASE_PATH,
  emailAndPassword: {
    enabled: true,
  },
  user: { modelName: 'auth_user' },
  session: { modelName: 'auth_session' },
  account: { modelName: 'auth_account' },
  verification: { modelName: 'auth_verification' },
  // Better Auth compares the database with its schema once per process and
  // keeps a mismatch until one of its own migrations clears it. Ours run in
  // the MCP container, which may start after the web app: a check made in
  // that window would keep sign-in broken until a restart. The migrations
  // are the schema's reference here, and `npx auth generate` reports drift.
  advanced: { database: { validateSchema: false } },
  plugins: [
    // Holds the signing keys and serves /jwks, against which the MCP server
    // verifies access tokens without calling back here. Nothing reads a session
    // JWT, so get-session does not sign one (and read the keys) on every page.
    jwt({ disableSettingJwtHeader: true, schema: { jwks: { modelName: 'auth_jwks' } } }),
    mcp({
      resource: mcpResource,
      loginPage: '/login',
      consentPage: '/consent',
      scopes: [MCP_SCOPE, 'offline_access'],
      // A person authorizes an AI client, nothing else: no machine-to-machine
      // grant to advertise or to defend.
      grantTypes: ['authorization_code', 'refresh_token'],
      // The MCP server verifies access tokens offline, so revoking an
      // authorization cannot reach one already issued: it lives until it
      // expires. Ten minutes bounds that delay; the client renews silently
      // with its refresh token, which revocation does delete.
      accessTokenExpiresIn: 600,
      extensions: [{ clientDiscovery: preregisteredClientDiscovery(PREREGISTERED_CLIENTS) }],
      schema: {
        oauthClient: { modelName: 'auth_oauth_client' },
        oauthResource: { modelName: 'auth_oauth_resource' },
        oauthClientResource: { modelName: 'auth_oauth_client_resource' },
        oauthRefreshToken: { modelName: 'auth_oauth_refresh_token' },
        oauthAccessToken: { modelName: 'auth_oauth_access_token' },
        oauthConsent: { modelName: 'auth_oauth_consent' },
        oauthClientAssertion: { modelName: 'auth_oauth_client_assertion' },
      },
    }),
    cimd({
      // Resolves the client's host once, refuses private addresses and
      // redirects: the metadata URL comes from whoever starts a flow.
      fetchClientMetadataResource,
      metadataProfile: 'mcp-2026-07-28',
    }),
  ],
})
