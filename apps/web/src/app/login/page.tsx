'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Field } from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
        <CardHeader>
          <p className="font-mono text-[15px] font-semibold">
            abacus<span className="text-faint">_</span>
          </p>
          <CardDescription className="text-muted-foreground">
            Finances personnelles, déclaratives.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)} className="mt-2">
            <TabsList className="w-full">
              <TabsTrigger value="signin">Connexion</TabsTrigger>
              <TabsTrigger value="signup">Créer un compte</TabsTrigger>
            </TabsList>
          </Tabs>

          <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
            {mode === 'signup' && (
              <Field label="Prénom">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="given-name"
                />
              </Field>
            )}
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </Field>
            <Field label="Mot de passe">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              />
            </Field>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" disabled={busy} className="mt-1">
              {busy ? '…' : mode === 'signin' ? 'Se connecter' : 'Créer le compte'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
