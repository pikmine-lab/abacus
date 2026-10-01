'use client'

import { PREREGISTERED_CLIENT_IDS } from '@abacus/core/oauth'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * Two steps: add the server, then authorize in the browser. There is no
 * secret to hand over, so what each client needs is the address in the form
 * it takes it; the authorization itself happens in abacus, on the consent
 * screen the client opens.
 */

/** The server name the agent will see; the product's name, not the user's. */
const SERVER_NAME = 'abacus'

function claudeCodeCommand(url: string): string {
  return `claude mcp add --transport http ${SERVER_NAME} \\\n  ${url} \\\n  --scope user`
}

function clientConfig(url: string): string {
  return JSON.stringify({ mcpServers: { [SERVER_NAME]: { type: 'http', url } } }, null, 2)
}

/** Cursor reads no metadata document: it names itself with the client_id it is given. */
function cursorConfig(url: string): string {
  return JSON.stringify(
    { mcpServers: { [SERVER_NAME]: { url, auth: { CLIENT_ID: PREREGISTERED_CLIENT_IDS.cursor } } } },
    null,
    2,
  )
}

function CodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative min-w-0 rounded-md border border-border bg-card">
      {/* Wrapping, not scrolling: half a copied command costs more than a long
          one, and nothing hides behind the button. */}
      <pre className="p-3 pr-24 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap text-foreground">
        {text}
      </pre>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="absolute top-2 right-2 h-7 text-[12px]"
        onClick={async () => {
          await navigator.clipboard.writeText(text)
          setCopied(true)
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? 'Copié' : 'Copier'}
      </Button>
    </div>
  )
}

/** The circled marker of a guided path, same as the first-run steps. */
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-primary/50 text-[11px] font-semibold text-primary tabular">
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <p className="text-[13px] font-semibold tracking-tight">{title}</p>
        {children}
      </div>
    </div>
  )
}

export function McpConnection({ mcpUrl }: { mcpUrl?: string }) {
  return (
    <div className="flex min-w-0 max-w-2xl flex-col gap-6">
      <Step n={1} title="Ajoute le serveur">
        {mcpUrl ? (
          <Tabs defaultValue="claude-app" className="min-w-0 gap-2.5">
            <TabsList className="h-7" aria-label="Client à brancher">
              <TabsTrigger value="claude-app" className="px-2 text-[12px]">
                App Claude
              </TabsTrigger>
              <TabsTrigger value="claude-code" className="px-2 text-[12px]">
                Claude Code
              </TabsTrigger>
              <TabsTrigger value="cursor" className="px-2 text-[12px]">
                Cursor
              </TabsTrigger>
              <TabsTrigger value="other" className="px-2 text-[12px]">
                Autre client
              </TabsTrigger>
            </TabsList>

            <TabsContent value="claude-app" className="flex min-w-0 flex-col gap-1.5">
              <p className="text-[12px] text-faint">connecteurs de l’app › connecteur personnalisé</p>
              <CodeBlock text={mcpUrl} />
            </TabsContent>

            <TabsContent value="claude-code" className="flex min-w-0 flex-col gap-1.5">
              <p className="text-[12px] text-faint">dans ton terminal</p>
              <CodeBlock text={claudeCodeCommand(mcpUrl)} />
            </TabsContent>

            <TabsContent value="cursor" className="flex min-w-0 flex-col gap-1.5">
              <p className="text-[12px] text-faint">dans ~/.cursor/mcp.json</p>
              <CodeBlock text={cursorConfig(mcpUrl)} />
            </TabsContent>

            <TabsContent value="other" className="flex min-w-0 flex-col gap-1.5">
              <p className="text-[12px] text-faint">
                l’adresse, ou ce bloc dans le fichier MCP de ton client
              </p>
              <CodeBlock text={mcpUrl} />
              <CodeBlock text={clientConfig(mcpUrl)} />
              <p className="text-[12px] text-faint">
                Microsoft 365 Copilot : identifiant client{' '}
                <span className="font-mono text-muted-foreground">
                  {PREREGISTERED_CLIENT_IDS.microsoft365Copilot}
                </span>
                , sans secret
              </p>
            </TabsContent>
          </Tabs>
        ) : (
          <p className="text-[12.5px] text-destructive">
            Adresse du serveur MCP absente (<span className="font-mono">MCP_URL</span>).
          </p>
        )}
      </Step>

      <Step n={2} title="Autorise l’accès">
        <p className="text-[12.5px] text-muted-foreground">
          Ton IA ouvre abacus dans le navigateur : connecte-toi, puis autorise.
        </p>
      </Step>
    </div>
  )
}
