'use client'

import { ChevronRightIcon } from 'lucide-react'

/**
 * A section that folds away, header included. Same native `<details>` as the
 * position masses and the analysis rankings, animated in `globals.css`: no
 * client state holds it, so it opens on what it was declared on rather than on
 * what the last visit left.
 *
 * It closes by default, which `Section` never does: what folds is a list one
 * declares once and rereads rarely, and it sits above what the page is opened
 * for. Work waiting to be done never goes behind a fold, whatever section it
 * used to share: it keeps a section of its own, unfolded.
 */
export function FoldSection({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  /** The list's own controls, at the end of the header row: its order, mostly. */
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col">
      <details className="fold group/section">
        {/* A control in the header is not the fold's handle: without this, a
            click on it would open its menu and close the section under it.
            Cancelled on the summary rather than around the control, because a
            handler on a plain box would be a click target of its own. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: a summary is the
            handle of its details, keyboard included; the rule does not know it. */}
        <summary
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('[data-keeps-fold]')) event.preventDefault()
          }}
          className="flex cursor-pointer list-none items-baseline gap-3 [&::-webkit-details-marker]:hidden"
        >
          <ChevronRightIcon className="size-3 shrink-0 self-center text-faint transition-transform group-open/section:rotate-90" />
          {/* Never wraps: the header holds a chevron and a control on top of
              what `Section` carries, and it is the description that gives way. */}
          <h2 className="shrink-0 text-[13px] font-semibold tracking-tight">{title}</h2>
          {description && <p className="min-w-0 truncate text-[11.5px] text-faint">{description}</p>}
          {action && (
            <div data-keeps-fold className="ml-auto">
              {action}
            </div>
          )}
        </summary>
        {/* The gap lives here rather than on the details, which would hold it
            open by three pixels once folded. */}
        <div className="pt-3">{children}</div>
      </details>
    </section>
  )
}
