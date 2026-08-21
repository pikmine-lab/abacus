'use client'

import { CheckIcon, CopyIcon } from 'lucide-react'
import { useActionState, useState } from 'react'
import { Field, SubmitButton } from '@/components/forms'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { createApiKeyAction } from '@/lib/actions'
import { cn } from '@/lib/utils'

/**
 * Two steps and a command. What the connection buys is said once by the page;
 * here the command is the content and everything around it stays a label. The
 * client chosen is not remembered because the whole command only exists while
 * the key is visible.
 */

/** Stands in for the key in the preview, before one exists. */
const KEY_PLACEHOLDER = 'ta-clé'

/** The server name the agent will see; the product's name, not the user's. */
const SERVER_NAME = 'abacus'

function claudeCodeCommand(url: string, key: string): string {
  return `claude mcp add --transport http ${SERVER_NAME} \\\n  ${url} \\\n  --scope user \\\n  --header "Authorization: Bearer ${key}"`
}

function clientConfig(url: string, key: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [SERVER_NAME]: {
          type: 'http',
          url,
          headers: { Authorization: `Bearer ${key}` },
        },
      },
    },
    null,
    2,
  )
}

/* Copy state is per text, so the caller keys the block by it: a new key must
   never show up as already copied. */
function CodeBlock({ text, copyable }: { text: string; copyable: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative min-w-0 rounded-md border border-border bg-card">
      {/* Wrapping, not scrolling: half a copied command costs more than a long
          one, and nothing hides behind the button. */}
      <pre
        className={cn(
          'p-3 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap',
          copyable ? 'pr-24 text-foreground' : 'pr-20 text-muted-foreground',
        )}
      >
        {text}
      </pre>
      {copyable ? (
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
          {copied ? 'Copiée' : 'Copier'}
        </Button>
      ) : (
        <Badge variant="outline" className="absolute top-2.5 right-2 text-[10.5px] text-faint">
          aperçu
        </Badge>
      )}
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
  const [state, formAction] = useActionState(createApiKeyAction, {})
  const key = state.key ?? KEY_PLACEHOLDER

  return (
    <div className="flex min-w-0 max-w-2xl flex-col gap-6">
      <Step n={1} title="Crée une clé">
        <form action={formAction} key={`form-${state.key ?? ''}`} className="flex flex-wrap items-end gap-2">
          <Field label="Nom" name="name" className="w-48">
            <Input name="name" required placeholder="claude-code" className="h-9" />
          </Field>
          <SubmitButton size="sm" className="h-9">
            Créer
          </SubmitButton>
          {state.key && (
            <p aria-live="polite" className="self-center text-[12px] text-good">
              ✓ visible une seule fois
            </p>
          )}
        </form>
      </Step>

      <Step n={2} title="Colle la commande">
        {mcpUrl ? (
          <Tabs defaultValue="claude-code" className="min-w-0 gap-2.5">
            <TabsList className="h-7" aria-label="Client à brancher">
              <TabsTrigger value="claude-code" className="px-2 text-[12px]">
                Claude Code
              </TabsTrigger>
              <TabsTrigger value="autre" className="px-2 text-[12px]">
                Autre client
              </TabsTrigger>
            </TabsList>

            <TabsContent value="claude-code" className="flex min-w-0 flex-col gap-1.5">
              <p className="text-[12px] text-faint">dans ton terminal</p>
              <CodeBlock
                key={`cc-${key}`}
                text={claudeCodeCommand(mcpUrl, key)}
                copyable={state.key !== undefined}
              />
            </TabsContent>

            <TabsContent value="autre" className="flex min-w-0 flex-col gap-1.5">
              <p className="text-[12px] text-faint">dans le fichier MCP de ton client</p>
              <CodeBlock
                key={`cfg-${key}`}
                text={clientConfig(mcpUrl, key)}
                copyable={state.key !== undefined}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <p className="text-[12.5px] text-destructive">
            Adresse du serveur MCP absente (<span className="font-mono">MCP_URL</span>).
          </p>
        )}
      </Step>
    </div>
  )
}
