import { ArrowUpRightIcon } from 'lucide-react'
import Link from 'next/link'
import { BackLink } from '@/components/back-link'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

/**
 * The page frame. Cards are for things that are genuinely separable objects;
 * a page's own title, filter row and lists are not, so they live on the page
 * ground with hairlines and spacing doing the separating.
 */
export function PageHeader({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  /** Primary actions, right-aligned: at most one filled button. */
  children?: React.ReactNode
}) {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6">
      {/* Desktop folds the sidebar from its own edge (SidebarEdgeToggle); on
          mobile the sidebar is a sheet, which needs a trigger in the header. */}
      <SidebarTrigger className="-ml-1 text-muted-foreground sm:hidden" />
      <Separator orientation="vertical" className="mr-1 !h-4 sm:hidden" />
      <BackLink />
      <div className="min-w-0">
        <h1 className="truncate text-[15px] leading-tight font-semibold">{title}</h1>
        {description && <p className="truncate text-[11.5px] text-faint">{description}</p>}
      </div>
      {children && <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>}
    </header>
  )
}

/** One scoping row under the header: period first, then dimensions. */
export function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-background/85 px-4 py-2.5 backdrop-blur-md sm:px-6">
      {children}
    </div>
  )
}

export function PageBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <main className={cn('flex flex-col gap-8 px-4 py-6 sm:px-6', className)}>{children}</main>
}

/**
 * A titled block on the page ground. `href` turns the title into a way out
 * toward the page that owns the detail: a dashboard block that shows
 * subscriptions has to lead to subscriptions.
 */
export function Section({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="flex items-baseline gap-3">
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
        {description && <p className="min-w-0 truncate text-[11.5px] text-faint">{description}</p>}
        {/* No shrink-0: an action carrying several controls wraps them rather
            than pushing the row past the page edge on a narrow screen. */}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  )
}

/**
 * The way out of a block toward the page that owns the detail. One shape for
 * every such link (top-right of its block, arrow at icon size), so "this
 * leads somewhere" is always the same signal.
 */
export function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-primary"
    >
      {children}
      <ArrowUpRightIcon className="size-3.5" />
    </Link>
  )
}

/** Marks a row as leading elsewhere; the row itself carries the link. */
export function RowArrow() {
  return (
    <ArrowUpRightIcon className="ml-auto size-4 shrink-0 text-faint transition-colors group-hover:text-primary" />
  )
}

/** A hairline-separated list: the default container, used instead of a card. */
export function Rows({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex flex-col divide-y divide-border/70 border-y border-border', className)}>
      {children}
    </div>
  )
}

export function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="py-3 text-[13px] text-faint">{children}</p>
}
