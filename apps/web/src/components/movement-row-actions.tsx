'use client'

import { EllipsisIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useActionState, useEffect, useState } from 'react'
import type { LinkChoice } from '@/components/advance-links'
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
  links,
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
  /** What the panel offers to link the movement to, as on declaration. */
  links?: { claims: LinkChoice[]; expenses: LinkChoice[]; commitments: LinkChoice[]; incomes: LinkChoice[] }
  today: string
}) {
  const t = useTranslations('movements.row')
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
            aria-label={t('actionsOn', { label })}
          >
            <EllipsisIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuItem onSelect={() => editing.setOpen(true)}>
            <PencilIcon />
            {t('edit')}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
            <Trash2Icon />
            {t('delete')}
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
            <SheetTitle className="text-[15px]">{t('editTitle')}</SheetTitle>
          </SheetHeader>
          <div className="p-4">
            <MovementForm
              accounts={accounts}
              actors={actors}
              categories={categories}
              activities={activities}
              cards={cards}
              links={links}
              today={today}
              draft={draft}
            />
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteDescription', { label })}</AlertDialogDescription>
          </AlertDialogHeader>
          {state.error && <p className="text-xs text-destructive">{state.error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <form action={remove}>
              <input type="hidden" name="movementId" value={draft.id} />
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? '…' : t('delete')}
              </Button>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
