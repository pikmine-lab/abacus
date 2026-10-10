import { ArrowUpRightIcon } from 'lucide-react'
import Link from 'next/link'
import { Children } from 'react'
import { type Delta, DeltaLine } from '@/components/stats'
import { useFormat } from '@/lib/format'
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

/**
 * "47 652" and "€": the number carries the figure, the unit stays quiet beside
 * it, on the side the language writes it ("47 652 €", "€47,652"). A signed
 * figure (a gain) carries its sign, which says the direction where colour
 * alone would not; an unknown one is a dash, never a zero.
 */
function Amount({
  value,
  decimals = 0,
  per,
  signed,
}: {
  value: number | null
  decimals?: number
  per?: string
  signed?: boolean
}) {
  const format = useFormat()
  if (value === null) return <span className="text-muted-foreground">—</span>
  // The language's own amount, cut into parts: only the sign € is set small,
  // so the minus and the spacing stay where the language puts them ("-694 €",
  // "-€694").
  const parts = new Intl.NumberFormat(format.locale, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: signed ? 'exceptZero' : 'auto',
  }).formatToParts(value)
  const unit = 'text-[0.5em] font-medium tracking-normal text-muted-foreground'
  const euro = parts.findIndex((p) => p.type === 'currency')
  // The space the language sets around the sign gives way to the margins below.
  const text = (from: number, to: number) =>
    parts
      .slice(from, to)
      .filter((p, i) => !(p.type === 'literal' && (from + i === euro - 1 || from + i === euro + 1)))
      .map((p) => p.value)
      .join('')
  const before = text(0, euro)
  const after = text(euro + 1, parts.length)
  return (
    <>
      {before}
      <span className={cn(after ? 'mr-0.5' : 'ml-1', unit)}>
        {parts[euro]?.value}
        {!after && per}
      </span>
      {after}
      {after && per && <span className={cn('ml-1', unit)}>{per}</span>}
    </>
  )
}

/**
 * A figure named by one word. `hero` is the one figure that dominates the
 * screen: exactly one per screen. `compact` is for figures that must not
 * outweigh what dominates: a list, or the hero figure they break into parts. A note appears only when it changes what the figure means (a method, a
 * missing declaration, a gross amount).
 */
export function Figure({
  label,
  qualifier,
  value,
  decimals,
  per,
  signed,
  delta,
  note,
  href,
  hero,
  compact,
}: {
  label: string
  qualifier?: string
  /** Null when it cannot be computed: the figure is a dash and its note says why. */
  value: number | null
  decimals?: number
  /** Unit suffix after the euro sign, e.g. "/mois". */
  per?: string
  /** A gain or a loss: written with its sign. */
  signed?: boolean
  delta?: Delta
  note?: React.ReactNode
  /** Makes the whole figure the way into the page that owns its detail. */
  href?: string
  hero?: boolean
  compact?: boolean
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
            : compact
              ? 'mt-2 mb-1.5 text-[22px] tracking-[-0.025em] sm:text-[28px]'
              : 'mt-2.5 mb-2 text-[30px] tracking-[-0.03em] sm:text-[40px]',
        )}
      >
        <Amount value={value} decimals={decimals} per={per} signed={signed} />
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

/** At most three cells complete a line of four, and they are interchangeable. */
const BLANKS = ['blank-1', 'blank-2', 'blank-3']

/**
 * Figures side by side, separated by hairlines rather than boxed; stacked on a
 * phone. A compact row holds three or four compact figures and pairs them on
 * a phone instead of stacking them, so the list they frame starts within the
 * first screen; an odd last figure takes the whole line.
 */
export function FigureRow({ compact, children }: { compact?: boolean; children: React.ReactNode }) {
  if (!compact)
    return (
      <div className="grid grid-cols-1 divide-y divide-border border-y border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0 [&>*]:py-4 sm:[&>*]:px-6 sm:[&>*:first-child]:pl-0">
        {children}
      </div>
    )
  // The hairlines are the gaps of the grid showing the rule colour behind
  // figures painted with the page ground: one rule for both directions, where
  // dividers would need a different set per layout.
  // toArray, not count: a figure left out by a condition is a `false` child,
  // which count still counts.
  const items = Children.toArray(children)
  const count = items.length
  // One or two figures share the line, past four they wrap by four. A wrapped last
  // line is completed with blank cells: a missing cell would show the rule
  // colour the hairlines are drawn with as a filled block.
  const columns = count <= 2 ? Math.max(count, 1) : count === 3 ? 3 : 4
  const blanks = (columns - (count % columns)) % columns
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-px border-y border-border bg-border [&>*]:bg-background [&>*]:py-3 [&>*]:pr-4 [&>*]:pl-4 max-sm:[&>*:nth-child(odd)]:pl-0 sm:[&>*]:px-6 sm:[&>*:nth-child(4n+1)]:pl-0',
        columns === 1
          ? 'sm:grid-cols-1'
          : columns === 2
            ? 'sm:grid-cols-2'
            : columns === 3
              ? 'sm:grid-cols-3'
              : 'sm:grid-cols-4',
        // The last figure, not the last cell: blanks are gone on a phone.
        count % 2 === 1 && 'max-sm:[&>:nth-last-child(1_of_:not([aria-hidden]))]:col-span-2',
      )}
    >
      {items}
      {BLANKS.slice(0, blanks).map((key) => (
        <div key={key} aria-hidden className="max-sm:hidden" />
      ))}
    </div>
  )
}

/**
 * The one card of a screen: what waits on the user. A card because it is a
 * separable object, a to-do list one could take away, unlike the readings that
 * live on the page ground. What only asks for attention (an alert) joins it
 * under its own quiet label rather than opening a second card.
 */
export function ActionCard({
  label,
  scrolls,
  children,
}: {
  label: string
  /** Held to the height the screen gives it, it scrolls within, under its name. */
  scrolls?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        'rounded-xl border border-border bg-card px-4 pb-1 sm:px-5',
        scrolls && 'pane-scroll min-h-0 overflow-y-auto',
      )}
    >
      {/* Sticky only in its own scroll: elsewhere it would ride the page's under its header. */}
      <h2
        className={cn(
          'pt-3 pb-1 text-[13px] font-medium text-muted-foreground',
          scrolls && 'sticky top-0 z-10 bg-card',
        )}
      >
        {label}
      </h2>
      <div className="flex flex-col divide-y divide-border">{children}</div>
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
