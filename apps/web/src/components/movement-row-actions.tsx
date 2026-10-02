'use client'

import { EllipsisIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import type { CardChoice } from '@/components/card-forms'
import { useEntryPanel } from '@/components/entry-dock'
import { type ActivityOption, type MovementDraft, MovementForm } from '@/components/movement-form'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { deleteMovementAction } from '@/lib/actions'
import { cn } from '@/lib/utils'

interface Option {
  id: string
  name: string
}

/**
 * Per-row actions on a declared movement. A declarative ledger is typed by
 * hand, so correcting a line has to be as reachable as writing it: one menu at
 * the end of the row, correction in the same panel used to declare (docked in
 * the same place on a screen with an EntryDock), deletion behind a
 * confirmation because nothing else undoes it.
 */
export function MovementRowActions({
  draft,
  label,
  accounts,
  actors,
  categories,
  activities,
  cards,
  today,
}: {
  draft: MovementDraft
  /** Names the movement in the confirmation, so the right one is deleted. */
  label: string
  accounts: Option[]
  actors: Option[]
  categories: Option[]
  activities: ActivityOption[]
  cards?: CardChoice[]
  today: string
}) {
  const editing = useEntryPanel()
  const [confirming, setConfirming] = useState(false)
  const [state, remove, pending] = useActionState(deleteMovementAction, {})

  // Close on success only: a refused deletion has a reason to show.
  useEffect(() => {
    if (state.ok) setConfirming(false)
  }, [state.ok])

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-faint hover:text-foreground"
            aria-label={`Actions sur ${label}`}
          >
            <EllipsisIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuItem onSelect={() => editing.setOpen(true)}>
            <PencilIcon />
            Modifier
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
            <Trash2Icon />
            Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Sheet {...editing.sheet}>
        <SheetContent
          {...editing.content}
          className={cn('w-full gap-0 overflow-y-auto sm:max-w-md', editing.content.className)}
          // No description to read: what changes is the form itself.
          aria-describedby={undefined}
        >
          <SheetHeader className="border-b border-border">
            <SheetTitle className="text-[15px]">Modifier le mouvement</SheetTitle>
          </SheetHeader>
          <div className="p-4">
            <MovementForm
              accounts={accounts}
              actors={actors}
              categories={categories}
              activities={activities}
              cards={cards}
              advances={[]}
              today={today}
              draft={draft}
            />
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce mouvement ?</AlertDialogTitle>
            <AlertDialogDescription>
              {label}. Les soldes et les analyses seront recalculés sans lui. Rien ne le restaure : il faudra
              le redéclarer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {state.error && <p className="text-xs text-destructive">{state.error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <form action={remove}>
              <input type="hidden" name="movementId" value={draft.id} />
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? '…' : 'Supprimer'}
              </Button>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
