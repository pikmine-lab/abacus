'use client'

import { useTranslations } from 'next-intl'
import { createContext, useContext } from 'react'
import { cn } from '@/lib/utils'

/**
 * How a screen that reads movements opens one: by its id, into the panel the
 * screen carries (`MovementPanel`). Kept apart from the panel so the
 * declaration form can lead to what it just wrote without importing the panel
 * that imports it.
 */
export interface MovementOpenerState {
  /** The movement the panel shows, if any. */
  openedId: string | null
  open: (id: string) => void
}

export const MovementOpenerContext = createContext<MovementOpenerState | null>(null)

/** Null outside a screen carrying a movement panel. */
export function useMovementOpener(): MovementOpenerState | null {
  return useContext(MovementOpenerContext)
}

/**
 * The whole row opens its movement: this button holds the row's name, and its
 * hit area stretches over the row, which has to be `relative` for it. A link
 * inside the row stays above it (`relative z-10`). The open row is washed
 * through `aria-current`, read by the row in CSS (`has-[[aria-current=true]]`).
 */
export function MovementOpener({
  id,
  label,
  className,
  children,
}: {
  id: string
  /** Names the movement for assistive technologies: several rows can share a counterparty. */
  label: string
  className?: string
  children: React.ReactNode
}) {
  const t = useTranslations('movements.panel')
  const opener = useMovementOpener()
  return (
    <button
      type="button"
      aria-label={t('open', { label })}
      aria-current={opener?.openedId === id}
      onClick={() => opener?.open(id)}
      className={cn(
        'block w-full cursor-pointer text-left outline-none after:absolute after:inset-0 after:content-[""]',
        'focus-visible:after:ring-2 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset',
        className,
      )}
    >
      {children}
    </button>
  )
}
