'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { BeadState } from '@/components/abacus-gate'
import { Door } from '@/components/door'
import { Field, FieldErrors } from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { authClient } from '@/lib/auth-client'

/** The AI client whose authorization opened this page, named with its domain. */
export interface WaitingClient {
  name: string
  domain: string | null
}

// What Better Auth requires of a new password (its default minimum).
const MIN_PASSWORD = 8
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// How long a bead takes to land (globals.css, `.gate-bead`).
const LANDING_MS = 450

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Sign-up refusals that belong to one field. Better Auth answers in English
// for whoever reads the code; the person reads these.
const SIGNUP_ERRORS: Record<string, { field: string; message: string }> = {
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: { field: 'email', message: 'Un compte existe déjà avec cet email.' },
  INVALID_EMAIL: { field: 'email', message: 'Email invalide.' },
  PASSWORD_TOO_SHORT: { field: 'password', message: `${MIN_PASSWORD} caractères minimum.` },
  PASSWORD_TOO_LONG: { field: 'password', message: 'Mot de passe trop long.' },
}

/**
 * Signing in and creating an account. One signs in at every visit and
 * creates an account once, so creating one is a link under the form, not a
 * tab of equal weight.
 *
 * The abacus above counts the way in: who you are (email, plus a first name
 * for a new account), your password, then the server's answer, its bead
 * leaving on submit and landing only once the server accepts.
 */
export function LoginForm({ client }: { client: WaitingClient | null }) {
  const router = useRouter()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [entered, setEntered] = useState(false)

  const signup = mode === 'signup'
  const identified = EMAIL.test(email.trim()) && (!signup || name.trim() !== '')
  const keyed = signup ? password.length >= MIN_PASSWORD : password !== ''
  const beads: BeadState[] = [
    identified ? 'counted' : 'idle',
    keyed ? 'counted' : 'idle',
    entered ? 'counted' : busy ? 'pending' : 'idle',
  ]

  function missing(): Record<string, string> {
    const found: Record<string, string> = {}
    if (signup && !name.trim()) found.name = 'Prénom requis.'
    if (!email.trim()) found.email = 'Email requis.'
    else if (!EMAIL.test(email.trim())) found.email = 'Email invalide.'
    if (!password) found.password = 'Mot de passe requis.'
    else if (signup && password.length < MIN_PASSWORD) found.password = `${MIN_PASSWORD} caractères minimum.`
    return found
  }

  function edit(field: string, set: (value: string) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      set(e.target.value)
      if (fields[field]) setFields(({ [field]: _, ...rest }) => rest)
    }
  }

  function switchMode() {
    setMode(signup ? 'signin' : 'signup')
    setFields({})
    setError(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const found = missing()
    setFields(found)
    setError(null)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    const result = signup
      ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
      : await authClient.signIn.email({ email: email.trim(), password })
    if (result.error) {
      setBusy(false)
      const refusal = signup ? SIGNUP_ERRORS[result.error.code ?? ''] : undefined
      if (refusal) setFields({ [refusal.field]: refusal.message })
      else setError(signup ? 'Inscription impossible.' : 'Email ou mot de passe incorrect.')
      return
    }
    setEntered(true)
    // Reached from an AI client, the server answers with where the
    // authorization goes next and the client plugin navigates there itself.
    // The button stays busy until the page leaves, so no second submit races it.
    if ((result.data as { redirect?: boolean } | null)?.redirect) return
    // The last bead lands before the page goes: three in place is what
    // "you are in" looks like. Without motion there is nothing to wait for.
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) await wait(LANDING_MS)
    router.push('/')
    router.refresh()
  }

  return (
    <Door beads={beads}>
      <h1 className="sr-only">{signup ? 'Créer un compte' : 'Connexion'}</h1>
      {client && (
        <p className="mt-5 text-[13px] text-muted-foreground">
          {signup ? 'Crée ton compte' : 'Connecte-toi'} pour autoriser{' '}
          <span className="font-medium text-foreground">{client.name}</span>
          {client.domain && <span className="block font-mono text-[12px] text-faint">{client.domain}</span>}
        </p>
      )}

      {/* noValidate: validation is ours, so the browser never puts a bubble
          on a field the person was not editing. */}
      <form noValidate onSubmit={submit} className="mt-6 flex flex-col gap-3">
        <FieldErrors.Provider value={fields}>
          {signup && (
            <Field label="Prénom" name="name">
              <Input name="name" value={name} onChange={edit('name', setName)} autoComplete="given-name" />
            </Field>
          )}
          <Field label="Email" name="email">
            <Input
              name="email"
              type="email"
              value={email}
              onChange={edit('email', setEmail)}
              autoComplete="email"
            />
          </Field>
          <Field label="Mot de passe" name="password">
            <Input
              name="password"
              type="password"
              value={password}
              onChange={edit('password', setPassword)}
              autoComplete={signup ? 'new-password' : 'current-password'}
            />
          </Field>
        </FieldErrors.Provider>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} aria-busy={busy} className="mt-2">
          {signup ? 'Créer le compte' : 'Se connecter'}
        </Button>
      </form>

      <button
        type="button"
        onClick={switchMode}
        disabled={busy}
        className="mt-4 self-start rounded-sm text-[13px] text-muted-foreground underline decoration-faint underline-offset-4 outline-none hover:text-foreground hover:decoration-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
      >
        {signup ? 'J’ai déjà un compte' : 'Créer un compte'}
      </button>
    </Door>
  )
}
