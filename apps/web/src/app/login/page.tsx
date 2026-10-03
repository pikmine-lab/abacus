import { auth } from '@abacus/core/auth'
import { clientDomain } from '@abacus/core/authorizations'
import { LoginForm, type WaitingClient } from '@/components/login-form'
import { oauthQuery } from '@/lib/oauth-query'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Connexion' }

/**
 * The AI client waiting behind this sign-in, when an authorization opened it.
 * Better Auth answers only for a request it signed and that is still live, so
 * a crafted link cannot make this page name a client; anything else is a
 * plain sign-in.
 */
async function waitingClient(query: URLSearchParams): Promise<WaitingClient | null> {
  const clientId = query.get('client_id')
  if (!clientId || !query.get('sig')) return null
  const client = (await auth.api
    .getOAuthClientPublicPrelogin({ body: { client_id: clientId, oauth_query: query.toString() } })
    .catch(() => null)) as { client_name?: string; client_uri?: string } | null
  if (!client) return null
  return { name: client.client_name ?? clientId, domain: clientDomain(clientId, client.client_uri) }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const client = await waitingClient(oauthQuery(await searchParams))
  return <LoginForm client={client} />
}
