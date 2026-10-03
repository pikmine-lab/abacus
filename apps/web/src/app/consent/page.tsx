import { auth } from '@abacus/core/auth'
import { clientDomain } from '@abacus/core/authorizations'
import { TriangleAlertIcon } from 'lucide-react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { BeadState } from '@/components/abacus-gate'
import { ConsentAnswer } from '@/components/consent-answer'
import { Door } from '@/components/door'
import { oauthQuery } from '@/lib/oauth-query'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Autoriser une IA' }

// Whoever reaches consent is signed in: the abacus is complete, the way the
// sign-in left it. An expired request has nothing left to count.
const IN: BeadState[] = ['counted', 'counted', 'counted']
const EMPTY: BeadState[] = ['idle', 'idle', 'idle']

/**
 * Where the authorization code is sent. A loopback address or an app scheme
 * means a program on this computer receives it, which the user must see
 * before saying yes: any local program can listen there.
 */
function redirectTarget(uri: string | null): { label: string; local: boolean } | null {
  if (!uri) return null
  try {
    const url = new URL(uri)
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
      return { label: `${url.protocol}//${url.host}`, local: true }
    const host = url.hostname
    const local =
      host === 'localhost' || host.endsWith('.localhost') || host.startsWith('127.') || host === '[::1]'
    return { label: url.host, local }
  } catch {
    return null
  }
}

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = oauthQuery(await searchParams)

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect(`/login?${query}`)

  // The query is signed by the authorization server, which checks the
  // signature again when the answer comes back: an altered request never gets
  // a code. Its expiry is read here only to say so before the user answers.
  const clientId = query.get('client_id')
  const live = Number(query.get('exp')) * 1000 > Date.now()
  const client =
    live && clientId
      ? ((await auth.api
          .getOAuthClientPublic({ query: { client_id: clientId }, headers: await headers() })
          .catch(() => null)) as { client_name?: string; client_uri?: string } | null)
      : null

  if (!clientId || !client) {
    return (
      <Door beads={EMPTY}>
        <h1 className="mt-6 text-[17px] font-semibold tracking-tight">Demande expirée</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Relance la connexion depuis ton IA.</p>
      </Door>
    )
  }

  const domain = clientDomain(clientId, client.client_uri)
  const target = redirectTarget(query.get('redirect_uri'))

  return (
    <Door beads={IN}>
      <h1 className="mt-6 text-[17px] font-semibold tracking-tight text-balance">
        {client.client_name ?? clientId} veut accéder à ton compte
      </h1>
      {domain && <p className="mt-1 font-mono text-[12px] text-faint">{domain}</p>}

      <p className="mt-4 text-[13px] text-muted-foreground">
        Il pourra consulter et déclarer tout ce que tu vois ici, au nom de{' '}
        <span className="text-foreground">{session.user.email}</span>.
      </p>

      {target && (
        <div className="mt-4 border-t pt-4 text-[12px]">
          <p className="text-faint">
            retour vers <span className="font-mono text-muted-foreground">{target.label}</span>
          </p>
          {target.local && (
            <p className="mt-1.5 flex items-start gap-1.5 text-primary">
              <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
              Un programme de cet ordinateur recevra l’accès. Autorise seulement si tu viens de lancer la
              connexion.
            </p>
          )}
        </div>
      )}

      <ConsentAnswer className="mt-6" />
    </Door>
  )
}
