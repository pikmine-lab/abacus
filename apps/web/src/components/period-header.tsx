import type { Reading } from '@abacus/core/domain'
import { BackLink } from '@/components/back-link'
import { PeriodStepper, PresetTabs } from '@/components/period-picker'
import { ReadingTabs } from '@/components/reading-tabs'
import { SidebarTrigger } from '@/components/ui/sidebar'
import type { Period } from '@/lib/period'

/**
 * The header of a screen that reads everything over one period: the period is
 * its visible title, the controls that scope it sit on the same line. The
 * screen's name stays the document heading for assistive technology; on screen
 * the navigation already says where one is.
 */
export function PeriodHeader({
  title,
  period,
  reading,
}: {
  title: string
  period: Period
  reading: Reading
}) {
  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-background/85 px-4 py-2.5 backdrop-blur-md sm:px-6">
      {/* On mobile the sidebar is a sheet, which needs a trigger in the header. */}
      <SidebarTrigger className="-ml-1 text-muted-foreground sm:hidden" />
      <BackLink />
      <h1 className="sr-only">{title}</h1>
      <PeriodStepper period={period} heading />
      {/* On a phone each segmented control takes a whole line rather than
          scrolling out of sight: a control one cannot see is not offered. */}
      <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
        <PresetTabs period={period} />
        <ReadingTabs value={reading} />
      </div>
    </header>
  )
}
