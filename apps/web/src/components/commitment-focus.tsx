'use client'

import { useEffect } from 'react'
import { idParam } from '@/lib/utils'

/**
 * Lands on the commitment a link names (`?commitment=<id>`): a commitment has
 * no page of its own, so a movement tied to one leads to its row. The row is
 * brought into view, the folds holding it are opened (an ended commitment
 * waits in a closed one), and it is washed as a chosen row is. Rows mark
 * themselves with `data-commitment`.
 *
 * Read from the address at mount: going back restores the server render.
 */
export function CommitmentFocus() {
  useEffect(() => {
    const id = idParam(new URLSearchParams(window.location.search).get('commitment') ?? undefined)
    const row = id && document.querySelector<HTMLElement>(`[data-commitment="${id}"]`)
    if (!row) return
    for (let fold = row.closest('details'); fold; fold = fold.parentElement?.closest('details') ?? null)
      fold.open = true
    row.dataset.focused = 'true'
    row.scrollIntoView({ block: 'center' })
  }, [])
  return null
}
