'use client'

import { ArrowLeftIcon } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * The way back from a cross-page jump. Links that leave a page tag themselves
 * with `?de=<clé>`; this reads the tag and offers a return.
 *
 * It goes back through history rather than to a fresh URL, so the period and
 * the filters of the page left behind are exactly as they were. Only when
 * there is no history to pop (a pasted link) does it fall back to the plain
 * route.
 */
const ORIGINS: Record<string, { label: string; href: string }> = {
  accueil: { label: 'Vue d’ensemble', href: '/' },
  analyse: { label: 'Analyse', href: '/analyse' },
  mouvements: { label: 'Mouvements', href: '/mouvements' },
  depenses: { label: 'Dépenses récurrentes', href: '/depenses-recurrentes' },
  revenus: { label: 'Revenus récurrents', href: '/revenus-recurrents' },
  comptes: { label: 'Comptes', href: '/comptes' },
}

export function BackLink() {
  const router = useRouter()
  const origin = ORIGINS[useSearchParams().get('de') ?? '']
  if (!origin) return null

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back()
        else router.push(origin.href)
      }}
      className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
    >
      <ArrowLeftIcon className="size-3.5" />
      <span className="hidden sm:inline">{origin.label}</span>
    </button>
  )
}
