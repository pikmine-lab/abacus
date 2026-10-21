import type { Executor } from '../client.ts'

/**
 * The AI clients a user let in, read straight from the tables the auth server
 * keeps (auth_oauth_*), without the auth server itself: the MCP server holds
 * no auth secret to build one. Columns there are camelCase, as Better Auth
 * names them.
 */

export interface ConnectionRow {
  consentId: string
  clientId: string
  name: string | null
  uri: string | null
  grantedAt: Date
  /** The client's last token refresh: tokens last ten minutes, so it reads as "last used". */
  lastUsedAt: Date | null
}

export async function listConnections(
  tx: Executor,
  userId: string,
  limit: number,
  offset: number,
): Promise<ConnectionRow[]> {
  return await tx<ConnectionRow[]>`
    select c.id as consent_id, c."clientId" as client_id, cl.name, cl.uri, c."createdAt" as granted_at,
           (select max(r."createdAt") from auth_oauth_refresh_token r
            where r."clientId" = c."clientId" and r."userId" = c."userId") as last_used_at
    from auth_oauth_consent c
    left join auth_oauth_client cl on cl."clientId" = c."clientId"
    where c."userId" = ${userId}
    order by c."createdAt" desc, c.id
    limit ${limit} offset ${offset}
  `
}

export async function consentClient(
  tx: Executor,
  userId: string,
  consentId: string,
): Promise<string | undefined> {
  const [row] = await tx<{ clientId: string }[]>`
    select "clientId" from auth_oauth_consent where id = ${consentId} and "userId" = ${userId}
  `
  return row?.clientId
}

/** The consent and every token of that client for that user. */
export async function deleteConnection(tx: Executor, userId: string, consentId: string, clientId: string) {
  await tx`delete from auth_oauth_access_token where "clientId" = ${clientId} and "userId" = ${userId}`
  await tx`delete from auth_oauth_refresh_token where "clientId" = ${clientId} and "userId" = ${userId}`
  await tx`delete from auth_oauth_consent where id = ${consentId} and "userId" = ${userId}`
}

export async function hasConsent(tx: Executor, userId: string, clientId: string): Promise<boolean> {
  const [row] = await tx`
    select 1 from auth_oauth_consent where "userId" = ${userId} and "clientId" = ${clientId} limit 1
  `
  return Boolean(row)
}
