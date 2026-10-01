import { auth } from '@abacus/core/auth'
import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider'

// RFC 8414 inserts the well-known segment before the issuer's path, and the
// issuer carries Better Auth's mount (/api/auth): the document lives outside
// that mount, so the catch-all auth route never sees the request. A client
// reads it to learn the endpoints and that it may present a metadata URL as
// its client_id. Public, so any origin may read it.
export const GET = oauthProviderAuthServerMetadata(auth, { headers: { 'Access-Control-Allow-Origin': '*' } })
