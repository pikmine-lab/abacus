'use client'

import { ArrowLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'

/**
 * The way back from a cross-page jump. Links that leave a page tag themselves
 * with `?from=<key>`; this reads the tag and offers a return.
 *
 * It goes back through history rather than to a fresh URL, so the period and
 * the filters of the page left behind are exactly as they were. Only when
 * there is no history to pop (a pasted link) does it fall back to the plain
 * route.
 */
const ORIGINS = {
  overview: { screen: 'overview', href: '/' },
  analysis: { screen: 'analysis', href: '/analysis' },
  movements: { screen: 'movements', href: '/movements' },
  activity: { screen: 'activity', href: '/activity' },
  expenses: { screen: 'recurringExpenses', href: '/recurring-expenses' },
  income: { screen: 'recurringIncome', href: '/recurring-income' },
  accounts: { screen: 'accounts', href: '/accounts' },
  investments: { screen: 'investments', href: '/investments' },
  settings: { screen: 'settings', href: '/settings?part=activities' },
} as const

/** The look every return shares, whether it pops history or follows a link. */
const RETURN =
  'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground'

export function BackLink({ parent }: { parent?: { label: string; href: string } }) {
  const t = useTranslations('shell.screens')
  const router = useRouter()
  const from = useSearchParams().get('from') ?? ''
  const origin = Object.hasOwn(ORIGINS, from) ? ORIGINS[from as keyof typeof ORIGINS] : undefined
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
      <span className="hidden sm:inline">{t(origin.screen)}</span>
    </button>
  )
}
