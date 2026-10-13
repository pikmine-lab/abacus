'use client'

import Link, { useLinkStatus } from 'next/link'

/**
 * "Show more" on a list cut by a limit carried in the URL. A client-side
 * navigation, so the page is not reloaded: the reader stays where they were,
 * at the end of the list, and the rows added appear under it. It replaces the
 * history entry, since growing a list is not a place to go back to, and it
 * says it is loading and stops answering clicks until the rows are there.
 */
export function ShowMore({
  href,
  label,
  pendingLabel,
}: {
  href: string
  label: string
  pendingLabel: string
}) {
  return (
    <Link
      href={href}
      scroll={false}
      replace
      prefetch={false}
      className="self-start text-[12.5px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline has-data-pending:pointer-events-none"
    >
      <Label label={label} pendingLabel={pendingLabel} />
    </Link>
  )
}

function Label({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useLinkStatus()
  return pending ? <span data-pending="">{pendingLabel}</span> : label
}
