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
 */
export function ConsentAnswer() {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function answer(accept: boolean) {
    setBusy(true)
    setFailed(false)
    const { error } = await authClient.$fetch('/oauth2/consent', { method: 'POST', body: { accept } })
    if (error) {
      setBusy(false)
      setFailed(true)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={() => answer(false)}>
          Refuser
        </Button>
        <Button disabled={busy} onClick={() => answer(true)}>
          {busy ? '…' : 'Autoriser'}
        </Button>
      </div>
      {failed && (
        <p aria-live="polite" className="text-[12px] text-destructive">
          Demande expirée : relance la connexion depuis ton IA.
        </p>
      )}
    </div>
  )
}
