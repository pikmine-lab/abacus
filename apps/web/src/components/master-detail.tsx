'use client'

import { ArrowLeftIcon, ArrowUpRightIcon, PlusIcon, SearchIcon } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/*
 * A screen one comes to in order to set one precise thing, where nothing
 * dominates: one part at a time, its list in a pane of its own and the entry
 * picked from it beside, carrying its fields and its gestures. No part grows
 * the page: a list of four hundred actors scrolls inside its pane, the way a
 * list of four does.
 *
 * The part and the entry live in the URL, so a deep link opens on the entry
 * and the back button returns to the previous one.
 */

export interface Part {
  key: string
  label: string
  /** How many entries the part holds; absent for a part that is not a list. */
  count?: number
  href: string
}

/**
 * The parts of the screen, as navigation rather than as a control: switching
 * changes what the work area is for. Held under the header, so the way to
 * another part never scrolls away.
 */
export function PartTabs({ parts, current, label }: { parts: Part[]; current: string; label: string }) {
  return (
    <nav
      aria-label={label}
      className="sticky top-14 z-10 flex h-11 shrink-0 items-stretch gap-5 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6"
    >
      {parts.map((part) => {
        const active = part.key === current
        return (
          <Link
            key={part.key}
            href={part.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              // The bar under the active tab overlaps the header's hairline.
              '-mb-px flex items-center gap-1.5 border-b-2 text-[13px] transition-colors',
              active
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {part.label}
            {part.count !== undefined && (
              <span className="text-[11.5px] text-faint tabular max-[400px]:hidden">{part.count}</span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}

/**
 * The list and the sheet of the entry picked from it, side by side when the
 * container leaves room for both. Narrower, one at a time: the list, until an
 * entry is designated in the URL, then its sheet with a way back.
 */
export function MasterDetail({
  list,
  fiche,
  designated,
}: {
  list: React.ReactNode
  fiche: React.ReactNode
  /** Whether the URL names an entry (or a new one): only then does a narrow screen show the sheet. */
  designated: boolean
}) {
  return (
    <div className="@container">
      <div
        className={cn(
          // Side by side from a 48rem container: room for a list a name can be
          // read in, beside a sheet its fields fit in. Both panes then take the
          // height left under the header and the tabs, and scroll on their
          // own: the page itself never grows.
          'grid grid-cols-1 @3xl:h-[calc(100svh-6.25rem)] @3xl:grid-cols-[minmax(17rem,22rem)_1fr]',
        )}
      >
        <div
          className={cn(
            'flex min-h-0 flex-col @3xl:border-r @3xl:border-border',
            designated && '@max-3xl:hidden',
          )}
        >
          {list}
        </div>
        {/* Positioned, like the list's rows: the hidden native inputs of a
            checkbox or a select are placed absolutely, and would otherwise
            escape the pane and lengthen the page they are scrolled out of. */}
        <div
          className={cn(
            'pane-scroll relative min-h-0 @3xl:overflow-y-auto',
            !designated && '@max-3xl:hidden',
          )}
        >
          {fiche}
        </div>
      </div>
    </div>
  )
}

/**
 * The header's way to a blank sheet. Declaring an entry takes the same place
 * as correcting one, so the button reads as pressed while its sheet is the one
 * on display, as a docked entry panel's button does.
 */
export function NewEntryLink({ href, label, pressed }: { href: string; label: string; pressed: boolean }) {
  return (
    <Button
      asChild
      size="sm"
      className={cn('gap-1.5', pressed && 'bg-secondary text-primary hover:bg-secondary')}
    >
      <Link href={href} aria-current={pressed ? 'page' : undefined}>
        <PlusIcon className="size-4" />
        {label}
      </Link>
    </Button>
  )
}

/**
 * The pane of the list: its search and its order at the top, its rows
 * scrolling under them. The order control arrives rendered by the page, so it
 * gets a box of its own rather than a place in a list of siblings.
 */
export function ListPane({
  search,
  tools,
  children,
}: {
  search?: React.ReactNode
  tools?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <>
      {(search || tools) && (
        <div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-2 sm:px-6 @3xl:pr-4">
          {search}
          {tools && <div className="ml-auto shrink-0">{tools}</div>}
        </div>
      )}
      <div
        className={cn(
          'pane-scroll relative min-h-0 flex-1 px-4 pb-6 sm:px-6 @3xl:overflow-y-auto @3xl:pr-4',
          !search && !tools && 'pt-3',
        )}
      >
        {children}
      </div>
    </>
  )
}

/** The search over a list: it narrows the rows as one types, accents ignored. */
export function ListSearch({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (value: string) => void
  /** What the search reads, for assistive technology; the field itself says « Chercher ». */
  label: string
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <SearchIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Chercher"
        aria-label={label}
        className="h-8 pl-8 text-[13px]"
      />
    </div>
  )
}

/** Accent- and case-insensitive, so « energie » finds « Énergie ». */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** A quiet heading above the rows it gathers, with how many there are. */
export function GroupHeading({ label, count }: { label: string; count: number }) {
  return (
    <h3 className="flex items-baseline gap-2 px-2 pt-1 pb-1 text-[12px] font-medium text-faint">
      {label}
      <span className="tabular">{count}</span>
    </h3>
  )
}

/**
 * One entry of a list: what it is called, what qualifies it under the name,
 * and one attribute at the end. The whole row is the way to its sheet; the one
 * on display is washed and in full ink.
 */
export function EntryRow({
  href,
  selected,
  title,
  detail,
  trailing,
  muted,
}: {
  href: string
  /**
   * `designated` when the URL names this entry; `default` when it is shown
   * only because nothing was named, which a narrow screen, showing the list
   * alone, does not mark.
   */
  selected?: 'designated' | 'default'
  title: React.ReactNode
  detail?: React.ReactNode
  trailing?: React.ReactNode
  /** A closed entry: still there, still correctable, read after the others. */
  muted?: boolean
}) {
  const ref = useRef<HTMLAnchorElement>(null)
  // A deep link lands on its entry: the row is brought into its pane, never
  // the page scrolled.
  useEffect(() => {
    if (selected === 'designated') ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  return (
    <Link
      ref={ref}
      href={href}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-secondary/50',
        selected === 'designated' && 'bg-secondary text-foreground hover:bg-secondary',
        selected === 'default' && '@3xl:bg-secondary @3xl:text-foreground @3xl:hover:bg-secondary',
        muted && !selected && 'text-faint',
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          // A name is not cut for what qualifies it: it takes a second line
          // before the trailing attribute gives up its place.
          className={cn(
            'line-clamp-2 text-[13px] break-words',
            selected === 'designated' && 'font-medium',
            selected === 'default' && '@3xl:font-medium',
          )}
        >
          {title}
        </span>
        {detail && <span className="truncate text-[11.5px] text-faint">{detail}</span>}
      </span>
      {trailing && <span className="max-w-[45%] shrink-0 truncate text-[11.5px] text-faint">{trailing}</span>}
    </Link>
  )
}

/** Which entry a list marks, and whether the URL named it or it was picked by default. */
export interface Selection {
  id: string | null
  designated: boolean
}

/** How a row of a list reads the selection. */
export function selectionOf(selection: Selection, id: string): 'designated' | 'default' | undefined {
  if (selection.id !== id) return undefined
  return selection.designated ? 'designated' : 'default'
}

/** Said in the pane when a search leaves nothing, or the list is empty. */
export function ListEmpty({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-3 text-[12.5px] text-faint">{children}</p>
}

/**
 * The sheet of one entry: its name as the title, then its fields, then its
 * other gestures, the destructive one last. On a narrow screen it replaces the
 * list, so it names the way back.
 */
export function Fiche({
  title,
  badge,
  back,
  link,
  children,
}: {
  title: string
  /** One word that qualifies the entry, such as its kind. */
  badge?: React.ReactNode
  back: { href: string; label: string }
  /** The page that carries more of this entry, e.g. an activity's regime. */
  link?: { href: string; label: string }
  children: React.ReactNode
}) {
  return (
    <article aria-label={title} className="flex max-w-xl flex-col px-4 pt-3 pb-10 sm:px-6 @3xl:pt-5">
      <Link
        href={back.href}
        className="-ml-1.5 mb-2 flex w-fit items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground @3xl:hidden"
      >
        <ArrowLeftIcon className="size-3.5" />
        {back.label}
      </Link>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="min-w-0 text-[18px] leading-tight font-semibold tracking-[-0.01em] break-words">
          {title}
        </h2>
        {badge}
        {link && (
          <Link
            href={link.href}
            className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-[12.5px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-primary"
          >
            {link.label}
            <ArrowUpRightIcon className="size-3.5" />
          </Link>
        )}
      </header>
      <div className="mt-4 flex flex-col">{children}</div>
    </article>
  )
}

/** One gesture of a sheet, under its one-word name and a hairline. */
export function FicheSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label} className="mt-7 flex flex-col gap-3 border-t border-border pt-4">
      <h3 className="text-[13px] font-medium text-muted-foreground">{label}</h3>
      {children}
    </section>
  )
}
