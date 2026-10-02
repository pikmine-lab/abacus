'use client'

import { PlusIcon } from 'lucide-react'
import { useEntryPanel } from '@/components/entry-dock'
import { Button } from '@/components/ui/button'
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
  title,
  description,
  children,
  variant = 'default',
}: {
  /** Button text. Keep it a verb: "Déclarer", "Ajouter un compte". */
  label: string
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
          {label}
        </Button>
      </SheetTrigger>
      <SheetContent
        {...panel.content}
        className={cn('w-full gap-0 overflow-y-auto sm:max-w-md', panel.content.className)}
        // Without a description, say so rather than point at one that is not there.
        {...(description ? {} : { 'aria-describedby': undefined })}
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle className="text-[15px]">{title}</SheetTitle>
          {description && <SheetDescription className="text-[12px]">{description}</SheetDescription>}
        </SheetHeader>
        <div className="p-4">{children}</div>
      </SheetContent>
    </Sheet>
  )
}
