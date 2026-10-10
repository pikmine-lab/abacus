'use client'

import { EllipsisIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { useEntryPanel } from '@/components/entry-dock'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

/**
 * Entry lives in a side panel, never in the page: reading and declaring are
 * two different jobs, and the list has to keep the room.
 *
 * The panel deliberately stays open after a successful submit, because the forms
 * clear their own fields, and declaring the day's expenses is a burst of
 * five, not one. Escape and the close button end the burst. Inside an
 * EntryDock it docks beside the list rather than covering it.
 */
export function EntrySheet({
  label,
  short,
  title,
  description,
  children,
  variant = 'default',
}: {
  /** Button text. Keep it a verb: "Déclarer", "Ajouter un compte". */
  label: string
  /** The word kept on a phone, where a header carrying several entries has no room for the label. */
  short?: string
  title: string
  description?: string
  children: React.ReactNode
  variant?: 'default' | 'outline'
}) {
  const panel = useEntryPanel()
  return (
    <Sheet {...panel.sheet}>
      <SheetTrigger asChild>
        {/* Docked, the panel stays beside its button: the button then reads as
            pressed rather than as a second filled call to the same action. */}
        <Button
          size="sm"
          variant={variant}
          className="gap-1.5 data-[state=open]:bg-secondary data-[state=open]:text-primary data-[state=open]:hover:bg-secondary"
        >
          <PlusIcon className="size-4" />
          {short ? (
            <>
              <span className="max-sm:hidden">{label}</span>
              <span className="sm:hidden">{short}</span>
            </>
          ) : (
            label
          )}
        </Button>
      </SheetTrigger>
      <PanelContent {...panel.content} title={title} description={description}>
        {children}
      </PanelContent>
    </Sheet>
  )
}

export interface MenuEntry {
  /** The menu item: what the panel declares, named in full. */
  label: string
  title: string
  description?: string
  content: React.ReactNode
}

/**
 * The secondary entries of a header, gathered behind one menu where a phone
 * has no room to show them side by side. Each item opens the same panel its
 * button opens on a wider screen. A phone never docks, so the panels here are
 * plain sheets.
 */
export function EntryMenu({ label, entries }: { label: string; entries: MenuEntry[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" aria-label={label}>
            <EllipsisIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {entries.map((entry) => (
            <DropdownMenuItem key={entry.label} onSelect={() => setOpen(entry.label)}>
              <PlusIcon />
              {entry.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {entries.map((entry) => (
        <Sheet
          key={entry.label}
          open={open === entry.label}
          onOpenChange={(next) => setOpen(next ? entry.label : null)}
        >
          <PanelContent title={entry.title} description={entry.description}>
            {entry.content}
          </PanelContent>
        </Sheet>
      ))}
    </>
  )
}

function PanelContent({
  title,
  description,
  className,
  children,
  ...content
}: {
  title: string
  description?: string
  children: React.ReactNode
} & Pick<React.ComponentProps<typeof SheetContent>, 'className' | 'onInteractOutside'>) {
  return (
    <SheetContent
      {...content}
      className={cn('w-full gap-0 overflow-y-auto sm:max-w-md', className)}
      // Without a description, say so rather than point at one that is not there.
      {...(description ? {} : { 'aria-describedby': undefined })}
    >
      <SheetHeader className="border-b border-border">
        <SheetTitle className="text-[15px]">{title}</SheetTitle>
        {description && <SheetDescription className="text-[12px]">{description}</SheetDescription>}
      </SheetHeader>
      <div className="p-4">{children}</div>
    </SheetContent>
  )
}
