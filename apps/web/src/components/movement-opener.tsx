'use client'

import { useTranslations } from 'next-intl'
import { createContext, useContext, useEffect, useRef } from 'react'
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
 * The whole row opens its movement: this button holds the row's name, and a
 * click anywhere else in the row marked `data-movement-row` is handed to it. A
 * link or another control inside the row keeps its own gesture. The open row is
 * washed through `aria-current`, read by the row in CSS
 * (`has-[[aria-current=true]]`), and the row holding keyboard focus the way a
 * hovered one is (`has-focus-visible`).
 *
 * Not a pseudo-element stretched over a `relative` row: WebKit, hence every
 * browser on iOS, does not make a table row the containing block of what it
 * holds, so every row's hit area landed on the table and a tap always opened
 * the last movement.
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
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const button = ref.current
    const row = button?.closest('[data-movement-row]')
    if (!button || !row) return
    const onClick = (event: Event) => {
      if ((event.target as Element).closest('a, button, input, select, textarea, label')) return
      // Selecting text in the row is reading it, not opening it. A selection
      // left elsewhere on the page does not hold the row back.
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed && row.contains(selection.anchorNode)) return
      button.click()
    }
    row.addEventListener('click', onClick)
    return () => row.removeEventListener('click', onClick)
  }, [])

  return (
    <button
      ref={ref}
      type="button"
      aria-label={t('open', { label })}
      aria-current={opener?.openedId === id}
      onClick={() => opener?.open(id)}
      className={cn(
        'block w-full cursor-pointer rounded-sm text-left outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring/50',
        className,
      )}
    >
      {children}
    </button>
  )
}
