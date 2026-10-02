import { ArrowUpRightIcon } from 'lucide-react'
import Link from 'next/link'
import { type Delta, DeltaLine } from '@/components/stats'
import { cn } from '@/lib/utils'

/*
 * The pieces a screen is composed of once it has been redesigned (DESIGN.md
 * § Composition): one dominant figure, figures named by a single word, blocks
 * named by a single word, and one card for what waits on the user. Screens
 * not yet redesigned keep StatTile and Section until their turn.
 */

/** The way out toward the page that owns the detail: an arrow, named for assistive technology. */
function WayOut({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="ml-auto rounded-md p-1 text-faint transition-colors hover:bg-secondary/60 hover:text-primary"
    >
      <ArrowUpRightIcon className="size-3.5" />
    </Link>
  )
}

/**
 * A block named by one word. The name is a label, not a title: the content is
 * what is read, so the name stays quiet, and anything it would explain is shown
 * by the content instead.
 */
export function Block({
  label,
  qualifier,
  href,
  hrefLabel,
  rule,
  className,
  children,
}: {
  label: string
  /** A short qualifier that changes what the content means, e.g. the reading in use. */
  qualifier?: string
  href?: string
  /** Names where the arrow leads, for assistive technology. */
  hrefLabel?: string
  /** A hairline under the name, for blocks whose content is a list. */
  rule?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <section aria-label={label} className={cn('flex min-w-0 flex-col', className)}>
      <div className={cn('flex items-center gap-2', rule ? 'border-b border-border pb-2' : 'pb-1')}>
        <h2 className="text-[13px] font-medium text-muted-foreground">{label}</h2>
        {qualifier && <span className="text-[11.5px] text-faint">{qualifier}</span>}
        {href && <WayOut href={href} label={hrefLabel ?? label} />}
      </div>
      {children}
    </section>
  )
}

/** "47 652" and "€": the number carries the figure, the unit stays quiet beside it. */
function Amount({ value, decimals = 0, per }: { value: number; decimals?: number; per?: string }) {
  return (
    <>
      {value.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      <span className="ml-1 text-[0.5em] font-medium tracking-normal text-muted-foreground">€{per}</span>
    </>
  )
}

/**
 * A figure named by one word. `hero` is the one figure that dominates the
 * screen: exactly one per screen. A note appears only when it changes what the
 * figure means (a method, a missing declaration, a gross amount).
 */
export function Figure({
  label,
  qualifier,
  value,
  decimals,
  per,
  delta,
  note,
  href,
  hero,
}: {
  label: string
  qualifier?: string
  value: number
  decimals?: number
  /** Unit suffix after the euro sign, e.g. "/mois". */
  per?: string
  delta?: Delta
  note?: React.ReactNode
  /** Makes the whole figure the way into the page that owns its detail. */
  href?: string
  hero?: boolean
}) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        {qualifier && <span className="text-[11.5px] text-faint">{qualifier}</span>}
        {href && (
          <ArrowUpRightIcon
            aria-hidden
            className="ml-auto size-3.5 text-faint transition-colors group-hover:text-primary"
          />
        )}
      </div>
      <p
        className={cn(
          'font-semibold whitespace-nowrap tabular leading-none',
          hero
            ? 'mt-3 mb-3 text-[52px] tracking-[-0.035em] sm:text-[76px]'
            : 'mt-2.5 mb-2 text-[30px] tracking-[-0.03em] sm:text-[40px]',
        )}
      >
        <Amount value={value} decimals={decimals} per={per} />
      </p>
      {delta && <DeltaLine delta={delta} />}
      {note && <p className="text-[11.5px] text-faint">{note}</p>}
    </>
  )
  // The whole figure is the target, not only its arrow: a figure is what one
  // points at to see where it comes from.
  return (
    <div className="flex min-w-0 flex-col">
      {href ? (
        <Link href={href} className="group -mx-2 flex flex-col rounded-md px-2 py-1 hover:bg-secondary/40">
          {body}
        </Link>
      ) : (
        // Same box as a linked figure, so every figure of a row shares its baselines.
        <div className="-mx-2 flex flex-col px-2 py-1">{body}</div>
      )}
    </div>
  )
}

/** Figures side by side, separated by hairlines rather than boxed; stacked on a phone. */
export function FigureRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 divide-y divide-border border-y border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0 [&>*]:py-4 sm:[&>*]:px-6 sm:[&>*:first-child]:pl-0">
      {children}
    </div>
  )
}

/**
 * The one card of a screen: what waits on the user. A card because it is a
 * separable object, a to-do list one could take away, unlike the readings that
 * live on the page ground. What only asks for attention (an alert) joins it
 * under its own quiet label rather than opening a second card.
 */
export function ActionCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label} className="rounded-xl border border-border bg-card px-4 pt-3 pb-1 sm:px-5">
      <h2 className="text-[13px] font-medium text-muted-foreground">{label}</h2>
      <div className="mt-1 flex flex-col divide-y divide-border">{children}</div>
    </section>
  )
}

/** A quiet label inside an ActionCard, above the lines of another kind. */
export function ActionGroup({ label }: { label: string }) {
  // No hairline under the label: it names the lines that follow, it is not one of them.
  return <h3 className="border-b-0 pt-3 pb-1 text-[12px] font-medium text-faint">{label}</h3>
}

/** One line of an ActionCard: what waits, what qualifies it, and where it is done. */
export function ActionRow({
  href,
  icon,
  title,
  detail,
}: {
  href: string
  icon: React.ReactNode
  title: React.ReactNode
  detail?: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="group -mx-2 flex items-baseline gap-3 rounded-md px-2 py-2.5 hover:bg-secondary/40"
    >
      <span className="translate-y-0.5">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
        <span className="shrink-0 text-[13.5px] font-medium">{title}</span>
        {detail && <span className="truncate text-[12px] text-faint">{detail}</span>}
      </span>
      <ArrowUpRightIcon className="size-4 shrink-0 self-center text-faint transition-colors group-hover:text-primary" />
    </Link>
  )
}
