import type { Reading } from '@abacus/core/domain'
import { BackLink } from '@/components/back-link'
import { PeriodStepper, PresetTabs } from '@/components/period-picker'
import { ReadingTabs } from '@/components/reading-tabs'
import { SidebarTrigger } from '@/components/ui/sidebar'
import type { Period } from '@/lib/period'
import { cn } from '@/lib/utils'

/**
 * The header of a screen that reads everything over one period: the period is
 * its visible title, the controls that scope it sit on the same line. The
 * screen's name stays the document heading for assistive technology; on screen
 * the navigation already says where one is.
 *
 * A screen with a filter row passes it as children: it shares the header's
 * band, so the two stick together whatever height the period line wraps to.
 */
export function PeriodHeader({
  title,
  period,
  reading,
  actions,
  children,
}: {
  title: string
  period: Period
  reading: Reading
  /** Primary actions, at the end of the period line: at most one filled button. */
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <header className="@container sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
        {/* On mobile the sidebar is a sheet, which needs a trigger in the header. */}
        <SidebarTrigger className="-ml-1 text-muted-foreground sm:hidden" />
        <BackLink />
        <h1 className="sr-only">{title}</h1>
        <PeriodStepper period={period} heading />
        {/* On a phone each segmented control takes a whole line rather than
            scrolling out of sight: a control one cannot see is not offered.
            With actions, the line holds the period and the actions and the
            presets drop below them, decided by the header's own width: a
            docked panel narrows it as much as a tablet does. */}
        <div
          className={cn(
            'order-last flex w-full flex-wrap items-center gap-2',
            actions ? '@4xl:order-none @4xl:ml-auto @4xl:w-auto' : 'sm:order-none sm:ml-auto sm:w-auto',
          )}
        >
          <PresetTabs period={period} />
          <ReadingTabs value={reading} />
        </div>
        {actions && <div className="ml-auto flex shrink-0 items-center gap-2 @4xl:ml-0">{actions}</div>}
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5 sm:px-6">
          {children}
        </div>
      )}
    </header>
  )
}
