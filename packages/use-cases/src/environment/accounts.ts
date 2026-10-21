import { createHash, randomBytes } from 'node:crypto'
import { authIssuer, MCP_SCOPE, PREREGISTERED_CLIENT_IDS } from '@abacus/core/oauth'
import type { CaseUser } from '@abacus/use-case-language'
import { environment } from './index.ts'

/**
 * The user of each case, created and signed in without a screen, through the
 * app's real HTTP entry points: the sign-up, then the OAuth flow a client runs
 * for the MCP server (authorize, consent, code exchange with PKCE, as the
 * pre-registered client). Nothing of this shortcut lives in the app, so none
 * of it can reach production; the image check looks for the marker below.
 */

export const SUITE_MARKER = 'abacus-use-case-suite-shortcut'

const CLIENT_ID = PREREGISTERED_CLIENT_IDS.cursor
const REDIRECT_URI = 'http://localhost:8787/callback'

/**
 * A client address of its own for each case user: the auth server limits
 * sign-ups and token requests per address, and every case signs one up from
 * the same machine. It reads the
 * address from x-forwarded-for when the header holds a single one.
 */
function clientAddress(): string {
  const [a, b, c] = randomBytes(3)
  return `10.${a}.${b}.${c}`
}

async function signUp(address: string): Promise<Omit<CaseUser, 'accessToken'>> {
  const { webUrl } = environment()
  const email = `case-${randomBytes(6).toString('hex')}@${SUITE_MARKER}.test`
  const password = `pw-${randomBytes(12).toString('hex')}`
  const response = await fetch(`${authIssuer(webUrl)}/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: webUrl, 'x-forwarded-for': address },
    body: JSON.stringify({ name: 'Camille', email, password }),
  })
  if (!response.ok) throw new Error(`sign-up answered ${response.status}: ${await response.text()}`)
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const { user } = (await response.json()) as { user: { id: string } }
  return { id: user.id, email, password, cookie }
}

/** Authorize, consent and code exchange, as a browser and a client would. */
export async function mcpAccessToken(cookie: string, address = clientAddress()): Promise<string> {
  const { webUrl, mcpUrl } = environment()
  const issuer = authIssuer(webUrl)
  const verifier = randomBytes(32).toString('base64url')
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: `${MCP_SCOPE} offline_access`,
    state: 'case',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    resource: mcpUrl,
  })
  const authorize = await fetch(`${issuer}/oauth2/authorize?${query}`, {
    headers: { cookie, 'x-forwarded-for': address },
    redirect: 'manual',
  })
  const location =
    authorize.status === 200
      ? ((await authorize.json()) as { url: string }).url
      : authorize.headers.get('location')
  const consentQuery = new URL(location ?? '', webUrl).search.slice(1)
  const consent = await fetch(`${issuer}/oauth2/consent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: webUrl, 'x-forwarded-for': address },
    body: JSON.stringify({ accept: true, oauth_query: consentQuery }),
  })
  const { url } = (await consent.json()) as { url: string }
  const code = new URL(url).searchParams.get('code')
  if (!code) throw new Error(`the consent gave no code: ${url}`)
  const token = await fetch(`${issuer}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': address },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      resource: mcpUrl,
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
  })
  if (!token.ok) throw new Error(`the token exchange answered ${token.status}: ${await token.text()}`)
  return ((await token.json()) as { access_token: string }).access_token
}

export async function newUser(): Promise<CaseUser> {
  const address = clientAddress()
  const user = await signUp(address)
  return { ...user, accessToken: await mcpAccessToken(user.cookie, address) }
}
