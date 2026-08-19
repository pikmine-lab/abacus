'use client'

import { CheckIcon, CopyIcon } from 'lucide-react'
import { useActionState, useState } from 'react'
import { Field, SubmitButton } from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createApiKeyAction } from '@/lib/actions'

/* Own copy state, keyed by the key value so a new creation starts uncopied. */
function KeyReveal({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-2 rounded-md border border-grid bg-accent/30 p-3">
      <p className="text-xs text-muted-foreground">
        Copie cette clé maintenant : elle ne sera plus jamais affichée.
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-xs">{value}</code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(value)
            setCopied(true)
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? 'Copiée' : 'Copier'}
        </Button>
      </div>
    </div>
  )
}

export function ApiKeyForm() {
  const [state, formAction] = useActionState(createApiKeyAction, {})
  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} key={`form-${state.key ?? ''}`} className="flex flex-col gap-3">
        <Field label="Nom">
          <Input name="name" required placeholder="claude" />
        </Field>
        <SubmitButton className="self-start">Créer la clé</SubmitButton>
      </form>
      {state.key && <KeyReveal key={`reveal-${state.key}`} value={state.key} />}
    </div>
  )
}
