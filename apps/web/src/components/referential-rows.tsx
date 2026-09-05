'use client'

import type { ReattachableCount } from '@abacus/core/services/actors'
import { CombineIcon, Link2Icon, PencilIcon, TagIcon } from 'lucide-react'
import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import { Rows } from '@/components/page-shell'
import { RowMenu } from '@/components/row-menu'
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  type ActorFormState,
  addAliasAction,
  countReattachableAction,
  editActorAction,
  editCategoryAction,
  mergeActorsAction,
  reattachActorHistoryAction,
} from '@/lib/actions'
import { frDateLong } from '@/lib/utils'

/**
 * The vocabulary, as lists that can be repaired. A referential entry is
 * pointed at by id, so renaming one propagates on its own: what was filed
 * under it stays filed under it, under its new name.
 */

/** The readable part of a row, with its menu at the far end. */
function EntryLine({
  title,
  detail,
  trailing,
  children,
}: {
  title: string
  detail?: string
  /**
   * One attribute of the entry, read at the end of its own line: a second
   * line under the name would lengthen the list without adding a fact.
   */
  trailing?: string
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
      {trailing && <span className="max-w-[45%] truncate text-[11.5px] text-faint">{trailing}</span>}
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
      <EntryLine title={category.name} trailing={category.groupLabel ?? undefined}>
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

export interface ActorEntry {
  id: string
  name: string
  activityId: string | null
  note: string | null
  /** The other names that resolve to this actor. */
  aliases: string[]
  /** What this client does to an invoice, as percentages; null when not stated. */
  invoiceVatRate: string | null
  invoiceWithholdingRate: string | null
}

function percent(rate: string): string {
  return `${Number(rate).toLocaleString('fr-FR')} %`
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
  // The activity the actor had when its correction opened: a changed one
  // leaves movements behind, and the reattachment then names it as former.
  const activityBefore = useRef<string | null>(null)
  const [leftBehind, setLeftBehind] = useState(0)
  const [reattaching, setReattaching] = useState<{ previousActivityId: string | null } | null>(null)
  const closeReattach = useCallback(() => setReattaching(null), [])
  const activityName = activities.find((a) => a.id === actor.activityId)?.name
  const detail =
    [
      actor.aliases.length > 0 ? `aussi ${actor.aliases.join(', ')}` : null,
      activityName,
      actor.invoiceVatRate !== null ? `TVA ${percent(actor.invoiceVatRate)}` : null,
      actor.invoiceWithholdingRate !== null ? `retenue ${percent(actor.invoiceWithholdingRate)}` : null,
      actor.note,
    ]
      .filter(Boolean)
      .join(' · ') || undefined

  return (
    <>
      <EntryLine title={actor.name} detail={detail}>
        <EditItem
          onSelect={() => {
            activityBefore.current = actor.activityId
            setLeftBehind(0)
            setEditing(true)
          }}
        />
        <DropdownMenuItem onSelect={() => setAliasing(true)}>
          <TagIcon />
          Ajouter un alias
        </DropdownMenuItem>
        {activityName && (
          <DropdownMenuItem onSelect={() => setReattaching({ previousActivityId: null })}>
            <Link2Icon />
            Rattacher l’historique à l’activité
          </DropdownMenuItem>
        )}
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
            // Stays open when a changed activity left movements behind: the
            // acknowledgement points at the gesture that takes them along.
            onSuccess={(state: ActorFormState) =>
              state.leftBehind ? setLeftBehind(state.leftBehind) : setEditing(false)
            }
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
            {/* What this client does to an invoice: defaults a new invoice
                copies, which is why they belong to the payer, not the activity. */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Facturation</span>
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  name="invoiceVatRate"
                  label="TVA par défaut (%)"
                  inputMode="decimal"
                  defaultValue={actor.invoiceVatRate ?? ''}
                />
                <TextField
                  name="invoiceWithholdingRate"
                  label="Retenue par défaut (%)"
                  inputMode="decimal"
                  defaultValue={actor.invoiceWithholdingRate ?? ''}
                />
              </div>
            </div>
            <SubmitButton className="self-start">Enregistrer</SubmitButton>
          </ActionForm>
          {leftBehind > 0 && (
            <p className="text-[12px] text-faint">
              {plural(
                leftBehind,
                'mouvement déjà déclaré ne suit pas',
                'mouvements déjà déclarés ne suivent pas',
              )}{' '}
              :{' '}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => {
                  setEditing(false)
                  setReattaching({ previousActivityId: activityBefore.current })
                }}
              >
                rattacher l’historique
              </button>{' '}
              les reprend, maintenant ou plus tard depuis le menu de la ligne.
            </p>
          )}
        </DialogContent>
      </Dialog>

      {activityName && (
        <ReattachDialog
          actor={actor}
          activityName={activityName}
          previousActivityId={reattaching?.previousActivityId ?? null}
          open={reattaching !== null}
          onClose={closeReattach}
        />
      )}

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

function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`
}

/**
 * The explicit gesture that moves an actor's history onto its activity,
 * confirmed with the number it concerns. The count is asked of the server with
 * the very scope the gesture would run with, and follows the date as it moves.
 */
function ReattachDialog({
  actor,
  activityName,
  previousActivityId,
  open,
  onClose,
}: {
  actor: ActorEntry
  activityName: string
  /** The activity the actor just left, when the gesture follows a correction. */
  previousActivityId: string | null
  open: boolean
  /** Stable, so that closing on success fires once per success and not once per render. */
  onClose: () => void
}) {
  const [from, setFrom] = useState<string | undefined>(undefined)
  const [scope, setScope] = useState<ReattachableCount | null>(null)
  const [state, reattach, pending] = useActionState(reattachActorHistoryAction, {})

  useEffect(() => {
    if (!open) return
    let stale = false
    setScope(null)
    countReattachableAction(actor.id, from, previousActivityId).then((counted) => {
      if (!stale) setScope(counted)
    })
    return () => {
      stale = true
    }
  }, [open, actor.id, from, previousActivityId])

  // Close on success only: a refused reattachment has a reason to show.
  useEffect(() => {
    if (state.ok) onClose()
  }, [state, onClose])

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Rattacher l’historique de {actor.name} à {activityName} ?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {scope === null
              ? '…'
              : scope.count === 0
                ? `Rien à rattacher : l’historique de ${actor.name} est déjà sous ${activityName}, ou classé dans une autre activité.`
                : `${plural(scope.count, 'mouvement', 'mouvements')}${scope.since ? `, depuis le ${frDateLong(scope.since)},` : ''} ${scope.count > 1 ? 'passeront' : 'passera'} sous ${activityName}. Un mouvement classé dans une autre activité ne bouge pas.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field label="À partir du (optionnel)">
          <DateField name="from" onValueChange={setFrom} />
        </Field>
        {state.error && <p className="text-xs text-destructive">{state.error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <form action={reattach}>
            <input type="hidden" name="actorId" value={actor.id} />
            <input type="hidden" name="from" value={from ?? ''} />
            <input type="hidden" name="previousActivityId" value={previousActivityId ?? ''} />
            <Button type="submit" disabled={pending || !scope?.count}>
              {pending ? '…' : 'Rattacher'}
            </Button>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
