'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { authClient } from '@/lib/auth-client'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const result =
      mode === 'signin'
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ name, email, password })
    setBusy(false)
    if (result.error) {
      setError(
        mode === 'signin'
          ? 'Connexion refusée : vérifie l’email et le mot de passe.'
          : (result.error.message ?? 'Inscription impossible.'),
      )
      return
    }
    router.push('/')
    router.refresh()
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <p className="font-mono text-[15px] font-semibold">
          abacus<span className="text-faint">_</span>
        </p>
        <p className="mt-1 text-xs text-secondary-foreground">Finances personnelles, déclaratives.</p>

        <div className="mt-5 flex rounded-lg border border-border p-0.5 text-[13px]">
          {(['signin', 'signup'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`flex-1 cursor-pointer rounded-md py-1.5 transition-colors ${
                mode === m ? 'bg-wash font-semibold text-primary' : 'text-secondary-foreground'
              }`}
            >
              {m === 'signin' ? 'Connexion' : 'Créer un compte'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
          {mode === 'signup' && (
            <label htmlFor="lg-name" className="flex flex-col gap-1.5 text-xs text-secondary-foreground">
              Prénom
              <Input
                id="lg-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="given-name"
              />
            </label>
          )}
          <label htmlFor="lg-email" className="flex flex-col gap-1.5 text-xs text-secondary-foreground">
            Email
            <Input
              id="lg-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label htmlFor="lg-password" className="flex flex-col gap-1.5 text-xs text-secondary-foreground">
            Mot de passe
            <Input
              id="lg-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </label>
          {error && <p className="text-xs text-[#e66767]">{error}</p>}
          <Button type="submit" disabled={busy} className="mt-1">
            {busy ? '…' : mode === 'signin' ? 'Se connecter' : 'Créer le compte'}
          </Button>
        </form>
      </Card>
    </main>
  )
}
