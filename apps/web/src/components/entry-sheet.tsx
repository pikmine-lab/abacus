'use client'

import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

/**
 * Entry lives in a side panel, never in the page: reading and declaring are
 * two different jobs, and the list has to keep the room.
 *
 * The panel deliberately stays open after a successful submit — the forms
 * clear their own fields — because declaring the day's expenses is a burst of
 * five, not one. Escape and the close button end the burst.
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
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant={variant} className="gap-1.5">
          <PlusIcon className="size-4" />
          {label}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="text-[15px]">{title}</SheetTitle>
          {description && <SheetDescription className="text-[12px]">{description}</SheetDescription>}
        </SheetHeader>
        <div className="p-4">{children}</div>
      </SheetContent>
    </Sheet>
  )
}
