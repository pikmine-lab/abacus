'use client'

import { createContext, useContext, useId, useState, useSyncExternalStore } from 'react'
import type { SheetContent } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

/*
 * A ledger's entry panel, docked beside the list instead of covering it.
 * Declaring is a burst, and each line sent has to land in a list that stays
 * readable and clickable next to the panel: on a wide screen the panel opens
 * without a veil and the page makes room for it. Below that width there is no
 * room to share, and the panel is the ordinary modal sheet.
 *
 * Opt-in by wrapping a screen in EntryDock: the panels inside it (declaring,
 * correcting a row) share one dock, so opening one closes the other. Outside a
 * dock, the same panels behave as every other sheet of the app.
 */

/** Wide enough for a 28rem panel to leave the list a readable table. */
const DOCKING = '(min-width: 1280px)'

interface Dock {
  active: string | null
  setActive: (update: (current: string | null) => string | null) => void
  wide: boolean
}

const DockContext = createContext<Dock | null>(null)

function subscribe(onChange: () => void) {
  const query = window.matchMedia(DOCKING)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

export function EntryDock({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<string | null>(null)
  // False on the server: nothing is open on first paint, so nothing to dock.
  const wide = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DOCKING).matches,
    () => false,
  )
  return (
    <DockContext.Provider value={{ active, setActive, wide }}>
      <div
        className={cn(
          'transition-[padding] duration-200 ease-out motion-reduce:transition-none',
          wide && active !== null && 'pr-[28rem]',
        )}
      >
        {children}
      </div>
    </DockContext.Provider>
  )
}

/**
 * The state of one panel: docked when its screen has a dock and the screen is
 * wide enough, a plain sheet otherwise. Spread `sheet` on the Sheet and
 * `content` on its SheetContent.
 */
export function useEntryPanel(): {
  open: boolean
  setOpen: (open: boolean) => void
  sheet: { open: boolean; onOpenChange: (open: boolean) => void; modal: boolean }
  content: Pick<React.ComponentProps<typeof SheetContent>, 'className' | 'onInteractOutside'>
} {
  const dock = useContext(DockContext)
  const key = useId()
  const [alone, setAlone] = useState(false)

  if (!dock) {
    return {
      open: alone,
      setOpen: setAlone,
      sheet: { open: alone, onOpenChange: setAlone, modal: true },
      content: {},
    }
  }

  const open = dock.active === key
  // Closing only clears the dock if this panel is the one in it: a panel that
  // just lost its place to another must not close the newcomer.
  const setOpen = (next: boolean) =>
    dock.setActive((current) => (next ? key : current === key ? null : current))
  return {
    open,
    setOpen,
    sheet: { open, onOpenChange: setOpen, modal: !dock.wide },
    content: dock.wide
      ? {
          // The list beside it is meant to be used: a click there, or focus
          // moving to a row menu, must not dismiss the panel.
          onInteractOutside: (event) => event.preventDefault(),
          className: 'shadow-none data-[state=closed]:duration-200 data-[state=open]:duration-200',
        }
      : {},
  }
}
