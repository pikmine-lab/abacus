'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'

/**
 * The user's answer to an AI client asking for access. It goes from the
 * browser: Better Auth resumes the authorization from the request itself, and
 * the client plugin attaches the signed query of this page. Either way the
 * browser then goes back to the client, with a code or with access_denied,
 * and the plugin follows that redirect.
 *
 * `data-answer` lets the abacus above preview each answer (globals.css):
 * pointing at Refuser empties it, and a refusal sent keeps it empty, as does
 * an answer the server turned down (`data-expired`).
 */
export function ConsentAnswer({ className }: { className?: string }) {
  const [chosen, setChosen] = useState<'accept' | 'refuse' | null>(null)
  const [failed, setFailed] = useState(false)

  async function answer(accept: boolean) {
    setChosen(accept ? 'accept' : 'refuse')
    setFailed(false)
    const { error } = await authClient.$fetch('/oauth2/consent', { method: 'POST', body: { accept } })
    if (error) {
      setChosen(null)
      setFailed(true)
    }
  }

  return (
    <div className={className} data-expired={failed ? '' : undefined}>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          data-answer="refuse"
          data-chosen={chosen === 'refuse' ? '' : undefined}
          disabled={chosen !== null}
          aria-busy={chosen === 'refuse'}
          onClick={() => answer(false)}
        >
          Refuser
        </Button>
        <Button
          data-answer="accept"
          disabled={chosen !== null}
          aria-busy={chosen === 'accept'}
          onClick={() => answer(true)}
        >
          Autoriser
        </Button>
      </div>
      {failed && (
        <p aria-live="polite" className="mt-2 text-right text-[12px] text-destructive">
          Demande expirée : relance la connexion depuis ton IA.
        </p>
      )}
    </div>
  )
}
