'use client'

import { ArrowLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * The way back from a cross-page jump. Links that leave a page tag themselves
 * with `?from=<key>`; this reads the tag and offers a return.
 *
 * It goes back through history rather than to a fresh URL, so the period and
 * the filters of the page left behind are exactly as they were. Only when
 * there is no history to pop (a pasted link) does it fall back to the plain
 * route.
 */
const ORIGINS: Record<string, { label: string; href: string }> = {
  overview: { label: 'Vue d’ensemble', href: '/' },
  analysis: { label: 'Analyse', href: '/analysis' },
  movements: { label: 'Mouvements', href: '/movements' },
  activity: { label: 'Activité', href: '/activity' },
  expenses: { label: 'Dépenses récurrentes', href: '/recurring-expenses' },
  income: { label: 'Revenus récurrents', href: '/recurring-income' },
  accounts: { label: 'Comptes', href: '/accounts' },
  investments: { label: 'Placements', href: '/investments' },
  settings: { label: 'Réglages', href: '/settings?part=activities' },
}

/** The look every return shares, whether it pops history or follows a link. */
const RETURN =
  'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground'

export function BackLink({ parent }: { parent?: { label: string; href: string } }) {
  const router = useRouter()
  const origin = ORIGINS[useSearchParams().get('from') ?? '']
  // A page that belongs under another one (an activity's regime under its
  // activity) names that parent when no jump brought the reader here, or once
  // the page has been walked on its own: it is never a dead end.
  if (!origin)
    return parent ? (
      <Link href={parent.href} className={RETURN}>
        <ArrowLeftIcon className="size-3.5" />
        <span className="hidden sm:inline">{parent.label}</span>
      </Link>
    ) : null

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back()
        else router.push(origin.href)
      }}
      className={RETURN}
    >
      <ArrowLeftIcon className="size-3.5" />
      <span className="hidden sm:inline">{origin.label}</span>
    </button>
  )
}
