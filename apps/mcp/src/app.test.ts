import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, test } from 'node:test'
import { auth } from '@abacus/core/auth'
import { listAuthorizations, revokeAuthorization } from '@abacus/core/authorizations'
import { authIssuer, MCP_SCOPE, PREREGISTERED_CLIENT_IDS } from '@abacus/core/oauth'
import { listUserConnections, revokeUserConnection } from '@abacus/core/services/connections'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { toNodeHandler } from '@modelcontextprotocol/node'
import type { AuthInfo } from '@modelcontextprotocol/server'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { setupDb, teardownDb, truncateAll } from '../../../packages/core/test/helpers.ts'
import { createApp } from './app.ts'
import { protect, userIdOf } from './auth.ts'
import { buildServer } from './server.ts'

/**
 * The whole authorization flow a client runs, against the real authorization
 * server and the real token check: the web app's auth routes are served on
 * PUBLIC_URL (the MCP server fetches the signing keys there), and the client
 * is Cursor's pre-registered one, so it goes through the same discovery as in
 * production.
 */

const PUBLIC_URL = process.env.PUBLIC_URL as string
const MCP_URL = process.env.MCP_URL as string
const ISSUER = authIssuer(PUBLIC_URL)
const CLIENT_ID = PREREGISTERED_CLIENT_IDS.cursor

let authServer: Server

before(async () => {
  await setupDb()
  authServer = createServer(toNodeHandler({ fetch: (request) => auth.handler(request) }) as never)
  await new Promise<void>((resolve) =>
    authServer.listen(Number(new URL(PUBLIC_URL).port), '127.0.0.1', resolve),
  )
})
beforeEach(truncateAll)
after(async () => {
  await new Promise((resolve) => authServer.close(resolve))
  await teardownDb()
})

async function signUp(): Promise<{ cookie: string; userId: string }> {
  const response = await fetch(`${ISSUER}/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: PUBLIC_URL },
    body: JSON.stringify({
      name: 'Ada',
      email: `ada-${randomBytes(4).toString('hex')}@test.local`,
      password: 'correct-horse-battery',
    }),
  })
  assert.equal(response.status, 200, await response.clone().text())
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const { user } = (await response.json()) as { user: { id: string } }
  return { cookie, userId: user.id }
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

/** Runs authorize then consent, as the browser does, and returns the code. */
async function authorize(
  cookie: string,
  redirectUri: string,
  challenge: string,
  clientId: string = CLIENT_ID,
): Promise<string> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: `${MCP_SCOPE} offline_access`,
    state: 'state-1',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: MCP_URL,
  })
  const authorizeResponse = await fetch(`${ISSUER}/oauth2/authorize?${query}`, {
    headers: { cookie },
    redirect: 'manual',
  })
  // A fetch gets the redirect as JSON, a navigation as a 302.
  const location =
    authorizeResponse.status === 200
      ? ((await authorizeResponse.json()) as { url: string }).url
      : authorizeResponse.headers.get('location')
  const consentUrl = new URL(location ?? '', PUBLIC_URL)
  assert.equal(
    consentUrl.pathname,
    '/consent',
    `authorize answered ${authorizeResponse.status} ${consentUrl}`,
  )

  const consent = await fetch(`${ISSUER}/oauth2/consent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: PUBLIC_URL },
    body: JSON.stringify({ accept: true, oauth_query: consentUrl.search.slice(1) }),
  })
  const { url } = (await consent.json()) as { url: string }
  const back = new URL(url)
  assert.equal(`${back.origin}${back.pathname}`, redirectUri)
  assert.equal(back.searchParams.get('state'), 'state-1')
  return back.searchParams.get('code') as string
}

async function token(body: Record<string, string>): Promise<Response> {
  return fetch(`${ISSUER}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, resource: MCP_URL, ...body }),
  })
}

async function connect(cookie: string, redirectUri = 'http://localhost:8787/callback') {
  const { verifier, challenge } = pkce()
  const code = await authorize(cookie, redirectUri, challenge)
  const response = await token({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  })
  assert.equal(response.status, 200, await response.clone().text())
  return (await response.json()) as { access_token: string; refresh_token?: string; expires_in: number }
}

/** The token check alone, answering with the user it let through. */
const whoAmI = protect(async (_request, authInfo) => Response.json(authInfo.extra))

function mcpRequest(accessToken?: string): Request {
  return new Request(MCP_URL, {
    method: 'POST',
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  })
}

test('a client gets a short access token for the MCP endpoint, and the MCP server accepts it', async () => {
  const { cookie, userId } = await signUp()
  const tokens = await connect(cookie)

  // Ten minutes bound a token's life; a revocation cuts it at once anyway.
  assert.equal(tokens.expires_in, 600)
  assert.ok(tokens.refresh_token, 'offline_access yields a refresh token')

  const response = await whoAmI(mcpRequest(tokens.access_token))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { userId })
})

test('without a token the MCP server answers 401 and points to its metadata', async () => {
  const response = await whoAmI(mcpRequest())
  assert.equal(response.status, 401)
  const challenge = response.headers.get('www-authenticate') ?? ''
  assert.match(challenge, /^Bearer /)
  assert.ok(
    challenge.includes(
      `resource_metadata="${new URL(MCP_URL).origin}/.well-known/oauth-protected-resource/mcp"`,
    ),
    challenge,
  )

  const forged = await whoAmI(mcpRequest('not-a-token'))
  assert.equal(forged.status, 401)
})

test('the protected resource metadata names the authorization server', async () => {
  const server = createApp().listen(0, '127.0.0.1')
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const { port } = server.address() as AddressInfo
    const response = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource/mcp`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      resource: MCP_URL,
      resource_name: 'abacus',
      authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'],
      scopes_supported: [MCP_SCOPE],
    })
  } finally {
    server.close()
  }
})

test('the authorization server offers metadata documents and public clients, and no registration', async () => {
  const response = await fetch(`${ISSUER}/.well-known/oauth-authorization-server`)
  const metadata = (await response.json()) as Record<string, unknown>
  assert.equal(metadata.issuer, ISSUER)
  assert.equal(metadata.client_id_metadata_document_supported, true)
  assert.ok((metadata.token_endpoint_auth_methods_supported as string[]).includes('none'))
  assert.equal(metadata.registration_endpoint, undefined)
  assert.ok((metadata.scopes_supported as string[]).includes('offline_access'))
})

// A native client listens on whatever port the system gives it and registers
// its redirect without one, or with another.
test('a loopback redirect is accepted on any port', async () => {
  const { cookie } = await signUp()
  const tokens = await connect(cookie, 'http://localhost:51234/callback')
  assert.ok(tokens.access_token)
})

test('revoking an authorization stops its refresh token at once', async () => {
  const { cookie, userId } = await signUp()
  const tokens = await connect(cookie)
  const headers = new Headers({ cookie })

  const [authorization] = await listAuthorizations(userId, headers)
  assert.equal(authorization?.name, 'Cursor')
  assert.equal(authorization?.domain, 'cursor.com')

  await revokeAuthorization(userId, authorization.consentId, headers)
  // A second click, or another tab, finds nothing left to revoke.
  await revokeAuthorization(userId, authorization.consentId, headers)

  assert.deepEqual(await listAuthorizations(userId, headers), [])
  const refreshed = await token({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token as string,
  })
  assert.equal(refreshed.status, 400)
})

test('a revoked client is refused at its very next call, however long its token had left', async () => {
  const { cookie, userId } = await signUp()
  const tokens = await connect(cookie)
  assert.equal((await whoAmI(mcpRequest(tokens.access_token))).status, 200)

  const [connection] = await listUserConnections(userId)
  assert.equal(await revokeUserConnection(userId, connection!.id), true)

  const refused = await whoAmI(mcpRequest(tokens.access_token))
  assert.equal(refused.status, 401)
  assert.ok(
    (refused.headers.get('www-authenticate') ?? '').includes(
      `resource_metadata="${new URL(MCP_URL).origin}/.well-known/oauth-protected-resource/mcp"`,
    ),
  )
})

/** The MCP surface of one user, in process, as the other MCP tests reach it. */
async function toolsOf(userId: string) {
  const authInfo: AuthInfo = { token: 'test', clientId: userId, scopes: ['mcp'], extra: { userId } }
  const handler = createMcpHandler(({ authInfo: info }) => buildServer(userIdOf(info)))
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://in-process.test/mcp'), {
      fetch: (url, init) => handler.fetch(new Request(url, init), { authInfo }),
    }),
  )
  return async (args: Record<string, unknown>) => {
    const reply = (await client.callTool({ name: 'manage_connections', arguments: args })) as {
      isError?: boolean
      content: { text: string }[]
    }
    return {
      isError: reply.isError ?? false,
      json: JSON.parse(reply.content[0]!.text.startsWith('{') ? reply.content[0]!.text : '{}') as Record<
        string,
        unknown
      >,
      text: reply.content[0]!.text,
    }
  }
}

test('the MCP lists the connected applications as the web does, and revokes one', async () => {
  const { cookie, userId } = await signUp()
  const tokens = await connect(cookie)
  const headers = new Headers({ cookie })
  const call = await toolsOf(userId)

  const [web] = await listAuthorizations(userId, headers)
  const listed = (await call({ action: 'list' })).json.connections as Record<string, unknown>[]
  assert.equal(listed.length, 1)
  assert.equal(listed[0]!.id, web!.consentId)
  assert.equal(listed[0]!.name, web!.name)
  assert.equal(listed[0]!.domain, web!.domain)

  const revoked = await call({ action: 'revoke', connectionId: web!.consentId })
  assert.equal(revoked.isError, false, revoked.text)
  assert.deepEqual(await listAuthorizations(userId, headers), [])
  assert.deepEqual((await call({ action: 'list' })).json.connections, [])
  assert.equal((await whoAmI(mcpRequest(tokens.access_token))).status, 401)
  const refreshed = await token({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token as string,
  })
  assert.equal(refreshed.status, 400)

  const again = await call({ action: 'revoke', connectionId: web!.consentId })
  assert.equal(again.isError, true)
  assert.equal((await call({ action: 'revoke' })).isError, true)
})

test('the MCP lists the connected applications page by page', async () => {
  const { cookie, userId } = await signUp()
  await connect(cookie)
  await authorize(
    cookie,
    'https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect',
    pkce().challenge,
    PREREGISTERED_CLIENT_IDS.microsoft365Copilot,
  )
  const call = await toolsOf(userId)
  const page = async (offset: number) =>
    ((await call({ action: 'list', limit: 1, offset })).json.connections as { name: string }[]).map(
      (c) => c.name,
    )

  const [first, second, third] = [await page(0), await page(1), await page(2)]
  assert.equal(first.length, 1)
  assert.equal(second.length, 1)
  assert.deepEqual([...first, ...second].sort(), ['Cursor', 'Microsoft 365 Copilot'])
  assert.deepEqual(third, [])
})
