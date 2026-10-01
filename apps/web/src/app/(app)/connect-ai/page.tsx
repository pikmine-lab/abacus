import { auth } from '@abacus/core/auth'
import { listAuthorizations } from '@abacus/core/authorizations'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { AuthorizationRowActions } from '@/components/authorization-row-actions'
import { McpConnection } from '@/components/mcp-connection'
import { EmptyLine, PageBody, PageHeader, Rows, Section } from '@/components/page-shell'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Brancher une IA' }

/** What the connection buys, shown by the sentences it makes possible. */
const EXAMPLES = [
  '« j’ai payé 42 € de courses »',
  '« il me reste quoi à payer ? »',
  '« où part mon argent ? »',
]

function frDay(d: Date): string {
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default async function ConnectAiPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')

  const authorizations = await listAuthorizations(session.user.id, await headers())

  return (
    <>
      <PageHeader title="Brancher une IA" description="déclarer et consulter en conversation" />

      <PageBody>
        <div className="flex max-w-2xl flex-wrap gap-1.5">
          {EXAMPLES.map((example) => (
            <span
              key={example}
              className="rounded-md border border-border px-2 py-1 text-[12px] text-muted-foreground"
            >
              {example}
            </span>
          ))}
        </div>

        <McpConnection mcpUrl={process.env.MCP_URL} />

        <Section title="Applications autorisées">
          {authorizations.length === 0 ? (
            <EmptyLine>Aucune application.</EmptyLine>
          ) : (
            <Rows className="max-w-2xl">
              {authorizations.map((a) => (
                <div key={a.consentId} className="flex flex-wrap items-center gap-2 py-2.5">
                  <span className="text-[13px] font-medium">{a.name}</span>
                  {a.domain && <span className="font-mono text-[11px] text-faint">{a.domain}</span>}
                  <span className="ml-auto text-[11px] text-faint">
                    autorisée le {frDay(a.grantedAt)}
                    {a.lastUsedAt && ` · utilisée le ${frDay(a.lastUsedAt)}`}
                  </span>
                  <AuthorizationRowActions consentId={a.consentId} name={a.name} />
                </div>
              ))}
            </Rows>
          )}
        </Section>
      </PageBody>
    </>
  )
}
