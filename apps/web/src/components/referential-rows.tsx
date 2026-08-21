'use client'

import { CombineIcon, PencilIcon, TagIcon } from 'lucide-react'
import { useState } from 'react'
import { ActionForm, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import { Rows } from '@/components/page-shell'
import { RowMenu } from '@/components/row-menu'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  addAliasAction,
  editActivityAction,
  editActorAction,
  editCategoryAction,
  mergeActorsAction,
} from '@/lib/actions'

/**
 * The vocabulary, as lists that can be repaired. A referential entry is
 * pointed at by id, so renaming one propagates on its own: what was filed
 * under it stays filed under it, under its new name.
 */

/** The readable part of a row, with its menu at the far end. */
function EntryLine({
  title,
  detail,
  children,
}: {
  title: string
  detail?: string
  /** The row's menu items. */
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      {/* Takes the row's width so the menu sits at its far end. */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[12.5px]">{title}</span>
        {detail && <span className="truncate text-[11px] text-faint">{detail}</span>}
      </div>
      <RowMenu label={title}>{children}</RowMenu>
    </div>
  )
}

function EditItem({ onSelect }: { onSelect: () => void }) {
  return (
    <DropdownMenuItem onSelect={onSelect}>
      <PencilIcon />
      Modifier
    </DropdownMenuItem>
  )
}

function CategoryRow({ category }: { category: { id: string; name: string; groupLabel: string | null } }) {
  const [editing, setEditing] = useState(false)
  return (
    <>
      <EntryLine title={category.name} detail={category.groupLabel ?? undefined}>
        <EditItem onSelect={() => setEditing(true)} />
      </EntryLine>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{category.name}</DialogTitle>
          </DialogHeader>
          <ActionForm
            action={editCategoryAction}
            onSuccess={() => setEditing(false)}
            successLabel="Catégorie corrigée"
          >
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
        </DialogContent>
      </Dialog>
    </>
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
        <CategoryRow key={category.id} category={category} />
      ))}
    </Rows>
  )
}

function ActivityRow({ activity }: { activity: { id: string; name: string } }) {
  const [editing, setEditing] = useState(false)
  return (
    <>
      <EntryLine title={activity.name}>
        <EditItem onSelect={() => setEditing(true)} />
      </EntryLine>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{activity.name}</DialogTitle>
          </DialogHeader>
          <ActionForm
            action={editActivityAction}
            onSuccess={() => setEditing(false)}
            successLabel="Activité corrigée"
          >
            <input type="hidden" name="activityId" value={activity.id} />
            <TextField name="name" label="Nom" defaultValue={activity.name} />
            <SubmitButton className="self-start">Enregistrer</SubmitButton>
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function ActivityRows({ activities }: { activities: { id: string; name: string }[] }) {
  return (
    <Rows>
      {activities.map((activity) => (
        <ActivityRow key={activity.id} activity={activity} />
      ))}
    </Rows>
  )
}

export interface ActorEntry {
  id: string
  name: string
  activityId: string | null
  note: string | null
  /** The other names that resolve to this actor. */
  aliases: string[]
}

/**
 * An actor carries more than a name: the aliases that resolve to it, and the
 * duplicates it can absorb. Entry creates an actor as soon as a typed name
 * matches nothing, so this screen has to be able to undo that.
 */
function ActorRow({
  actor,
  activities,
  others,
}: {
  actor: ActorEntry
  activities: { id: string; name: string }[]
  /** The actors this one can be merged into. */
  others: { id: string; name: string }[]
}) {
  const [editing, setEditing] = useState(false)
  const [aliasing, setAliasing] = useState(false)
  const [merging, setMerging] = useState(false)
  const activityName = activities.find((a) => a.id === actor.activityId)?.name
  const detail =
    [actor.aliases.length > 0 ? `aussi ${actor.aliases.join(', ')}` : null, activityName, actor.note]
      .filter(Boolean)
      .join(' · ') || undefined

  return (
    <>
      <EntryLine title={actor.name} detail={detail}>
        <EditItem onSelect={() => setEditing(true)} />
        <DropdownMenuItem onSelect={() => setAliasing(true)}>
          <TagIcon />
          Ajouter un alias
        </DropdownMenuItem>
        {others.length > 0 && (
          <DropdownMenuItem variant="destructive" onSelect={() => setMerging(true)}>
            <CombineIcon />
            Fusionner dans…
          </DropdownMenuItem>
        )}
      </EntryLine>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{actor.name}</DialogTitle>
          </DialogHeader>
          <ActionForm
            action={editActorAction}
            onSuccess={() => setEditing(false)}
            successLabel="Acteur corrigé"
          >
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
        </DialogContent>
      </Dialog>

      <Dialog open={aliasing} onOpenChange={setAliasing}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Alias de {actor.name}</DialogTitle>
            <DialogDescription className="text-[12px]">
              Un nom de plus qui désigne cet acteur. Saisi tel quel dans un mouvement, il ne crée plus de
              doublon.
            </DialogDescription>
          </DialogHeader>
          <ActionForm
            action={addAliasAction}
            onSuccess={() => setAliasing(false)}
            successLabel="Alias ajouté"
          >
            <input type="hidden" name="actorId" value={actor.id} />
            <TextField name="alias" label="Alias" placeholder="Macdo" />
            <SubmitButton className="self-start">Ajouter</SubmitButton>
          </ActionForm>
        </DialogContent>
      </Dialog>

      <Dialog open={merging} onOpenChange={setMerging}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Fusionner {actor.name}</DialogTitle>
            <DialogDescription className="text-[12px]">
              Tout ce qui est déclaré sous « {actor.name} » bascule sur l’acteur choisi, et « {actor.name} »
              devient un de ses alias. C’est le seul geste ici qui réécrit des mouvements déjà déclarés.
            </DialogDescription>
          </DialogHeader>
          <ActionForm action={mergeActorsAction} onSuccess={() => setMerging(false)}>
            <input type="hidden" name="actorId" value={actor.id} />
            <Field label="Fusionner dans" name="keepId">
              <FormSelect
                name="keepId"
                required
                placeholder="Choisir l’acteur à garder"
                options={others.map((a) => ({ value: a.id, label: a.name }))}
              />
            </Field>
            <SubmitButton variant="destructive" className="self-start">
              Fusionner
            </SubmitButton>
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Beyond this, the list stops being readable and the search field takes over. */
const SHOWN = 60

export function ActorRows({
  actors,
  activities,
}: {
  actors: ActorEntry[]
  activities: { id: string; name: string }[]
}) {
  const [search, setSearch] = useState('')
  const term = search.trim().toLowerCase()
  const matches = (actor: ActorEntry) =>
    actor.name.toLowerCase().includes(term) || actor.aliases.some((a) => a.toLowerCase().includes(term))
  const matching = term ? actors.filter(matches) : actors
  const shown = matching.slice(0, SHOWN)

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
          <ActorRow
            key={actor.id}
            actor={actor}
            activities={activities}
            others={actors
              .filter((other) => other.id !== actor.id)
              .map((other) => ({ id: other.id, name: other.name }))}
          />
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
