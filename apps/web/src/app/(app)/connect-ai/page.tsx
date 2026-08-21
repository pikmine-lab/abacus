import { auth } from '@abacus/core/auth'
import { CheckIcon, XIcon } from 'lucide-react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { ApiKeyRowActions } from '@/components/api-key-row-actions'
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

  const { apiKeys } = await auth.api.listApiKeys({ headers: await headers() })

  return (
    <>
      <PageHeader title="Brancher une IA" description="déclarer et consulter en conversation" />

      <PageBody>
        <div className="flex max-w-2xl flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((example) => (
              <span
                key={example}
                className="rounded-md border border-border px-2 py-1 text-[12px] text-muted-foreground"
              >
                {example}
              </span>
            ))}
          </div>
          {/* Where a key works, and where it does not: found out here rather
              than in the client, where the failure is silent. */}
          <div className="flex flex-col gap-1 text-[12px]">
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <CheckIcon className="size-3.5 shrink-0 text-good" />
              Claude Code · Cursor · VS Code · Codex
            </p>
            <p className="flex items-center gap-1.5 text-faint">
              <XIcon className="size-3.5 shrink-0" />
              app Claude (web, bureau) : n’accepte pas de clé
            </p>
          </div>
        </div>

        <McpConnection mcpUrl={process.env.MCP_URL} />

        <Section title="Tes clés">
          {apiKeys.length === 0 ? (
            <EmptyLine>Aucune clé.</EmptyLine>
          ) : (
            <Rows className="max-w-2xl">
              {apiKeys.map((key) => (
                <div key={key.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <span className="text-[13px] font-medium">{key.name}</span>
                  {key.start && <span className="font-mono text-[11px] text-faint">{key.start}…</span>}
                  <span className="ml-auto text-[11px] text-faint">
                    créée le {frDay(key.createdAt)}
                    {key.lastRequest ? ` · utilisée le ${frDay(key.lastRequest)}` : ' · jamais utilisée'}
                  </span>
                  <ApiKeyRowActions keyId={key.id} name={key.name ?? 'sans nom'} />
                </div>
              ))}
            </Rows>
          )}
        </Section>
      </PageBody>
    </>
  )
}
