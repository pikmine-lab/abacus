'use client'

import { PencilIcon } from 'lucide-react'
import { useState } from 'react'
import { ActionForm, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import { Rows } from '@/components/page-shell'
import { RowMenu } from '@/components/row-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { editActivityAction, editActorAction, editCategoryAction } from '@/lib/actions'

/**
 * The vocabulary, as lists that can be repaired. A referential entry is
 * pointed at by id, so renaming one propagates on its own: what was filed
 * under it stays filed under it, under its new name.
 */

/** The rows of one referential: something to read, its correction in the menu. */
function EntryRow({
  title,
  detail,
  children,
}: {
  title: string
  detail?: string
  /** The correction panel, opened from the row's menu. */
  children: (close: () => void) => React.ReactNode
}) {
  const [editing, setEditing] = useState(false)
  return (
    <div className="flex items-center gap-3 py-2">
      {/* Takes the row's width so the menu sits at its far end. */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[12.5px]">{title}</span>
        {detail && <span className="truncate text-[11px] text-faint">{detail}</span>}
      </div>
      <RowMenu label={title}>
        <DropdownMenuItem onSelect={() => setEditing(true)}>
          <PencilIcon />
          Modifier
        </DropdownMenuItem>
      </RowMenu>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{title}</DialogTitle>
          </DialogHeader>
          {children(() => setEditing(false))}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function CategoryRows({
  categories,
}: {
  categories: { id: string; name: string; groupLabel: string | null }[]
}) {
  return (
    <Rows>
      {categories.map((category) => (
        <EntryRow key={category.id} title={category.name} detail={category.groupLabel ?? undefined}>
          {(close) => (
            <ActionForm action={editCategoryAction} onSuccess={close} successLabel="Catégorie corrigée">
              <input type="hidden" name="categoryId" value={category.id} />
              <TextField name="name" label="Nom" defaultValue={category.name} />
              <TextField
                name="group"
                label="Groupe (optionnel)"
                defaultValue={category.groupLabel ?? ''}
                placeholder="Vie courante"
              />
              <SubmitButton className="self-start">Enregistrer</SubmitButton>
            </ActionForm>
          )}
        </EntryRow>
      ))}
    </Rows>
  )
}

export function ActivityRows({ activities }: { activities: { id: string; name: string }[] }) {
  return (
    <Rows>
      {activities.map((activity) => (
        <EntryRow key={activity.id} title={activity.name}>
          {(close) => (
            <ActionForm action={editActivityAction} onSuccess={close} successLabel="Activité corrigée">
              <input type="hidden" name="activityId" value={activity.id} />
              <TextField name="name" label="Nom" defaultValue={activity.name} />
              <SubmitButton className="self-start">Enregistrer</SubmitButton>
            </ActionForm>
          )}
        </EntryRow>
      ))}
    </Rows>
  )
}

/** Beyond this, the list stops being readable and the search field takes over. */
const SHOWN = 60

export function ActorRows({
  actors,
  activities,
}: {
  actors: { id: string; name: string; activityId: string | null; note: string | null }[]
  activities: { id: string; name: string }[]
}) {
  const [search, setSearch] = useState('')
  const term = search.trim().toLowerCase()
  const matching = term ? actors.filter((a) => a.name.toLowerCase().includes(term)) : actors
  const shown = matching.slice(0, SHOWN)
  const activityName = new Map(activities.map((a) => [a.id, a.name]))

  return (
    <>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Chercher un acteur"
        className="h-8 w-56 text-[13px]"
        aria-label="Chercher un acteur"
      />
      <Rows>
        {shown.map((actor) => (
          <EntryRow
            key={actor.id}
            title={actor.name}
            detail={
              [actor.activityId ? activityName.get(actor.activityId) : null, actor.note]
                .filter(Boolean)
                .join(' · ') || undefined
            }
          >
            {(close) => (
              <ActionForm action={editActorAction} onSuccess={close} successLabel="Acteur corrigé">
                <input type="hidden" name="actorId" value={actor.id} />
                <TextField name="name" label="Nom" defaultValue={actor.name} />
                <Field label="Activité">
                  <FormSelect
                    name="activityId"
                    noneLabel="(perso)"
                    defaultValue={actor.activityId ?? ''}
                    options={activities.map((a) => ({ value: a.id, label: a.name }))}
                  />
                </Field>
                <TextField name="note" label="Note (optionnelle)" defaultValue={actor.note ?? ''} />
                <SubmitButton className="self-start">Enregistrer</SubmitButton>
              </ActionForm>
            )}
          </EntryRow>
        ))}
      </Rows>
      {matching.length > shown.length && (
        <p className="text-[11.5px] text-faint">
          {matching.length - shown.length} autres : affine la recherche pour les atteindre.
        </p>
      )}
      {matching.length === 0 && <p className="text-[11.5px] text-faint">Aucun acteur ne porte ce nom.</p>}
    </>
  )
}
