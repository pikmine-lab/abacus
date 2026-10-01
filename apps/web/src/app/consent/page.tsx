import { auth } from '@abacus/core/auth'
import { clientDomain } from '@abacus/core/authorizations'
import { TriangleAlertIcon } from 'lucide-react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { ConsentAnswer } from '@/components/consent-answer'
import { Logo } from '@/components/logo'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Autoriser une IA' }

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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <Logo className="size-7 text-faint" />
          <p className="font-mono text-[15px] font-semibold">
            abacus<span className="text-primary">_</span>
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
      </Card>
    </main>
  )
}

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v)
  }

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
      <Shell>
        <p className="text-[13px] text-muted-foreground">
          Cette demande d’autorisation a expiré. Relance la connexion depuis ton IA.
        </p>
      </Shell>
    )
  }

  const domain = clientDomain(clientId, client.client_uri)
  const target = redirectTarget(query.get('redirect_uri'))

  return (
    <Shell>
      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-semibold tracking-tight">
          {client.client_name ?? clientId} veut accéder à ton compte
        </p>
        {domain && <p className="font-mono text-[12px] text-faint">{domain}</p>}
      </div>

      <p className="text-[13px] text-muted-foreground">
        Il pourra consulter et déclarer tout ce que tu vois ici, au nom de {session.user.email}.
      </p>

      {target && (
        <div className="flex flex-col gap-1 text-[12px]">
          <p className="text-faint">
            retour vers <span className="font-mono text-muted-foreground">{target.label}</span>
          </p>
          {target.local && (
            <p className="flex items-start gap-1.5 text-primary">
              <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
              Un programme de cet ordinateur recevra l’accès. Autorise seulement si tu viens de lancer la
              connexion.
            </p>
          )}
        </div>
      )}

      <ConsentAnswer />
    </Shell>
  )
}
