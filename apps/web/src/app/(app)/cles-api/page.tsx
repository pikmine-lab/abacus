import { auth } from '@abacus/core/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { ApiKeyForm } from '@/components/api-key-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { deleteApiKeyAction } from '@/lib/actions'

export const dynamic = 'force-dynamic'

function frDate(d: Date): string {
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default async function ApiKeysPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')

  const { apiKeys } = await auth.api.listApiKeys({ headers: await headers() })

  return (
    <main className="grid items-start gap-3 lg:grid-cols-[1.55fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Clés d’API</CardTitle>
          <CardDescription>
            une clé donne à une IA l’accès à tes données via le serveur MCP (en-tête « Authorization: Bearer
            &lt;clé&gt; ») ; révoque toute clé qui ne sert plus
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col">
          {apiKeys.length === 0 && (
            <p className="text-sm text-faint">Aucune clé : crée la première ci-contre.</p>
          )}
          {apiKeys.map((key) => (
            <div key={key.id} className="border-b border-grid py-3 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{key.name}</span>
                {key.start && <span className="font-mono text-[11px] text-faint">{key.start}…</span>}
                <span className="ml-auto text-[11px] text-faint">
                  créée le {frDate(key.createdAt)}
                  {key.lastRequest ? ` · utilisée le ${frDate(key.lastRequest)}` : ' · jamais utilisée'}
                </span>
                <form action={deleteApiKeyAction}>
                  <input type="hidden" name="keyId" value={key.id} />
                  <Button variant="destructive" size="sm" type="submit">
                    Révoquer
                  </Button>
                </form>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nouvelle clé</CardTitle>
          <CardDescription>une clé par outil connecté, pour pouvoir les révoquer séparément</CardDescription>
        </CardHeader>
        <CardContent>
          <ApiKeyForm />
        </CardContent>
      </Card>
    </main>
  )
}
