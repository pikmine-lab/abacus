'use client'

import { ChevronLeftIcon } from 'lucide-react'
import { useSidebar } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

/**
 * The collapse control, sitting on the sidebar's own edge: folding the
 * navigation is an act on the navigation, so the handle belongs to it rather
 * than to the page header. The chevron points where the click leads.
 *
 * Hidden below `sm`, where the sidebar is a sheet and the header carries its
 * own trigger instead.
 */
export function SidebarEdgeToggle() {
  const { state, toggleSidebar } = useSidebar()
  const collapsed = state === 'collapsed'
  const label = collapsed ? 'Déplier la navigation' : 'Replier la navigation'
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label={label}
      aria-expanded={!collapsed}
      title={label}
      className="absolute top-1/2 -right-3 z-20 hidden size-6 -translate-y-1/2 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-faint transition-colors hover:border-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:flex"
    >
      <ChevronLeftIcon className={cn('size-3.5 transition-transform', collapsed && 'rotate-180')} />
    </button>
  )
}
