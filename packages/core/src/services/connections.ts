import { db } from '../db/client.ts'
import {
  consentClient,
  deleteConnection,
  hasConsent,
  listConnections,
} from '../db/datasources/connections.ts'

/**
 * What a user has let into their account, as the MCP server reads and revokes
 * it: one connection per AI client they consented to, the same rows the web
 * lists through the auth server (authorizations.ts). Revoking cuts the client
 * off at once: its consent and tokens go, and the MCP server refuses a token
 * whose consent is gone (isConnected), however long the token had left.
 */

export interface Connection {
  id: string
  clientId: string
  name: string
  /** Where the client comes from, shown beside its name: the name alone is self-declared. */
  domain: string | null
  grantedAt: Date
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

export async function listUserConnections(userId: string, limit = 50, offset = 0): Promise<Connection[]> {
  const rows = await listConnections(db(), userId, limit, offset)
  return rows.map((row) => ({
    id: row.consentId,
    clientId: row.clientId,
    name: row.name ?? row.clientId,
    domain: clientDomain(row.clientId, row.uri),
    grantedAt: new Date(row.grantedAt),
    lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt) : null,
  }))
}

/** Revokes one connection: false when the user has no such connection, already revoked included. */
export async function revokeUserConnection(userId: string, connectionId: string): Promise<boolean> {
  return await db().begin(async (tx) => {
    const clientId = await consentClient(tx, userId, connectionId)
    if (!clientId) return false
    await deleteConnection(tx, userId, connectionId, clientId)
    return true
  })
}

/** Whether a client still holds the user's consent: once revoked, none of its tokens opens anything. */
export async function isConnected(userId: string, clientId: string): Promise<boolean> {
  return await hasConsent(db(), userId, clientId)
}
