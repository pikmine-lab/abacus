import { APIError } from 'better-auth/api'
import { auth } from './auth.ts'

/**
 * What a user has let into their account: one row per AI client they
 * consented to. A consent is bound to the client_id, so two assistants never
 * share one, and revoking one leaves the others connected.
 */

export interface Authorization {
  consentId: string
  clientId: string
  name: string
  /** Where the client comes from, shown beside its name: the name alone is self-declared. */
  domain: string | null
  grantedAt: Date
  /** Last token refresh; tokens last ten minutes, so it reads as "last used". */
  lastUsedAt: Date | null
}

/**
 * The domain a client is known by. A metadata-document client IS the URL of
 * its document, and its name comes from that document, so the host of the URL
 * is the one thing about it the client cannot choose. A pre-registered client
 * carries the product's site instead.
 */
export function clientDomain(clientId: string, clientUri?: string | null): string | null {
  for (const candidate of [clientId, clientUri]) {
    if (!candidate) continue
    try {
      const url = new URL(candidate)
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.hostname
    } catch {}
  }
  return null
}

export async function listAuthorizations(userId: string, headers: Headers): Promise<Authorization[]> {
  const consents = (await auth.api.getOAuthConsents({ headers })) as {
    id: string
    clientId: string
    createdAt: Date
  }[]
  const { adapter } = await auth.$context
  return Promise.all(
    consents.map(async (consent) => {
      const client = (await auth.api
        .getOAuthClientPublic({ query: { client_id: consent.clientId }, headers })
        .catch(() => null)) as { client_name?: string; client_uri?: string } | null
      const [latest] = await adapter.findMany<{ createdAt: Date }>({
        model: 'oauthRefreshToken',
        where: [
          { field: 'clientId', value: consent.clientId },
          { field: 'userId', value: userId },
        ],
        sortBy: { field: 'createdAt', direction: 'desc' },
        limit: 1,
      })
      return {
        consentId: consent.id,
        clientId: consent.clientId,
        name: client?.client_name ?? consent.clientId,
        domain: clientDomain(consent.clientId, client?.client_uri),
        grantedAt: new Date(consent.createdAt),
        lastUsedAt: latest ? new Date(latest.createdAt) : null,
      }
    }),
  )
}

/**
 * Cuts a client off. Better Auth only deletes the consent row: the refresh
 * grant never reads it, so the client would keep renewing its tokens for as
 * long as it kept using them. The tokens of that client for that user go with
 * it, and the access token already issued expires within its ten minutes,
 * since the MCP server verifies it without asking the database.
 */
export async function revokeAuthorization(
  userId: string,
  consentId: string,
  headers: Headers,
): Promise<void> {
  // Better Auth answers NOT_FOUND rather than null: an authorization already
  // revoked (a second click, another tab) is not an error.
  const consent = (await auth.api.getOAuthConsent({ query: { id: consentId }, headers }).catch((e) => {
    if (e instanceof APIError && e.status === 'NOT_FOUND') return null
    throw e
  })) as { clientId: string } | null
  if (!consent) return
  const { adapter } = await auth.$context
  const where = [
    { field: 'clientId', value: consent.clientId },
    { field: 'userId', value: userId },
  ]
  await adapter.deleteMany({ model: 'oauthAccessToken', where })
  await adapter.deleteMany({ model: 'oauthRefreshToken', where })
  await auth.api.deleteOAuthConsent({ body: { id: consentId }, headers })
}
