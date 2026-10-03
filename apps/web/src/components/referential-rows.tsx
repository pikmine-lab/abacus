'use client'

import type { ReattachableCount } from '@abacus/core/services/actors'
import { Link2Icon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import {
  EntryRow,
  Fiche,
  FicheSection,
  fold,
  GroupHeading,
  ListEmpty,
  ListPane,
  ListSearch,
  type Selection,
  selectionOf,
} from '@/components/master-detail'
import { SuggestField } from '@/components/suggest-field'
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
  type ActorFormState,
  addAliasAction,
  countReattachableAction,
  createActorAction,
  createCategoryAction,
  editActorAction,
  editCategoryAction,
  mergeActorsAction,
  reattachActorHistoryAction,
} from '@/lib/actions'
import { entryHref } from '@/lib/entry-href'
import { frDateLong } from '@/lib/utils'

/**
 * The vocabulary, as lists that can be repaired. A referential entry is
 * pointed at by id, so renaming one propagates on its own: what was filed
 * under it stays filed under it, under its new name.
 */

interface Back {
  href: string
  label: string
}

/** The part of a name a search matched, in full ink; the rest as it was. */
function Matched({ text, term }: { text: string; term: string }) {
  const at = term ? fold(text).indexOf(term) : -1
  // Folding keeps the length of the Latin letters a name is made of; a name
  // where it does not is shown without the mark rather than marked off by one.
  if (at < 0 || fold(text).length !== text.length) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-transparent font-medium text-foreground">{text.slice(at, at + term.length)}</mark>
      {text.slice(at + term.length)}
    </>
  )
}

export interface CategoryEntry {
  id: string
  name: string
  groupLabel: string | null
}

/**
 * The categories, read under their group when the list is ordered by group,
 * the group then trailing each row when ordered by name. The search reads both,
 * so typing a group's name brings the whole group.
 */
export function CategoryList({
  categories,
  grouped,
  listHref,
  selection,
  tools,
}: {
  /** Already in the order the URL asked for. */
  categories: CategoryEntry[]
  grouped: boolean
  listHref: string
  selection: Selection
  /** The order control, beside the search. */
  tools?: React.ReactNode
}) {
  const [search, setSearch] = useState('')
  const term = fold(search.trim())
  const shown = term
    ? categories.filter((c) => fold(c.name).includes(term) || fold(c.groupLabel ?? '').includes(term))
    : categories
  const sections: { label: string | null; rows: CategoryEntry[] }[] = []
  for (const category of shown) {
    const last = sections.at(-1)
    if (grouped && last && last.label === category.groupLabel) last.rows.push(category)
    else if (grouped || !last) sections.push({ label: category.groupLabel, rows: [category] })
    else last.rows.push(category)
  }

  return (
    <ListPane
      search={<ListSearch value={search} onChange={setSearch} label="Chercher une catégorie ou un groupe" />}
      tools={tools}
    >
      {categories.length === 0 ? (
        <ListEmpty>Aucune catégorie. Sans elles, l’analyse par catégorie reste vide.</ListEmpty>
      ) : shown.length === 0 ? (
        <ListEmpty>Aucune catégorie ne porte ce nom.</ListEmpty>
      ) : (
        sections.map((section) => (
          <div key={section.label ?? ''} className="flex flex-col not-first:mt-4">
            {grouped && <GroupHeading label={section.label ?? 'Sans groupe'} count={section.rows.length} />}
            {section.rows.map((category) => (
              <EntryRow
                key={category.id}
                href={entryHref(listHref, category.id)}
                selected={selectionOf(selection, category.id)}
                title={<Matched text={category.name} term={term} />}
                trailing={grouped ? undefined : category.groupLabel}
              />
            ))}
          </div>
        ))
      )}
    </ListPane>
  )
}

/**
 * A category's sheet: its name and its group, the same two fields to declare
 * one. The group proposes those already in use, so a group is reused rather
 * than retyped into a near-duplicate.
 */
export function CategoryFiche({
  category,
  groups,
  back,
}: {
  /** Absent for a blank sheet, declaring a new category. */
  category?: CategoryEntry
  groups: string[]
  back: Back
}) {
  const editing = category !== undefined
  return (
    <Fiche title={editing ? category.name : 'Nouvelle catégorie'} back={back}>
      <ActionForm
        action={editing ? editCategoryAction : createCategoryAction}
        successLabel={editing ? 'Catégorie corrigée' : 'Catégorie créée'}
      >
        {editing && <input type="hidden" name="categoryId" value={category.id} />}
        <TextField name="name" label="Nom" defaultValue={category?.name ?? ''} />
        <SuggestField
          name="group"
          label="Groupe (optionnel)"
          defaultValue={category?.groupLabel ?? ''}
          suggestions={groups}
          placeholder="Vie courante"
        />
        <SubmitButton className="self-start">{editing ? 'Enregistrer' : 'Ajouter'}</SubmitButton>
      </ActionForm>
    </Fiche>
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

/**
 * The actors, the one list that keeps growing: entry creates one as soon as a
 * typed name matches nothing. The search reads the aliases too, and a row
 * found through one shows which.
 */
export function ActorList({
  actors,
  activities,
  listHref,
  selection,
  tools,
}: {
  actors: ActorEntry[]
  activities: { id: string; name: string }[]
  listHref: string
  selection: Selection
  tools?: React.ReactNode
}) {
  const [search, setSearch] = useState('')
  const term = fold(search.trim())
  const shown = term
    ? actors.filter(
        (a) => fold(a.name).includes(term) || a.aliases.some((alias) => fold(alias).includes(term)),
      )
    : actors

  return (
    <ListPane
      search={<ListSearch value={search} onChange={setSearch} label="Chercher un acteur ou un alias" />}
      tools={tools}
    >
      {actors.length === 0 ? (
        <ListEmpty>Aucun acteur. Le premier mouvement déclaré en crée un.</ListEmpty>
      ) : shown.length === 0 ? (
        <ListEmpty>Aucun acteur ne porte ce nom.</ListEmpty>
      ) : (
        shown.map((actor) => {
          // The alias the search went through comes first, marked.
          const aliases = term
            ? [...actor.aliases].sort(
                (a, b) => Number(fold(b).includes(term)) - Number(fold(a).includes(term)),
              )
            : actor.aliases
          return (
            <EntryRow
              key={actor.id}
              href={entryHref(listHref, actor.id)}
              selected={selectionOf(selection, actor.id)}
              title={<Matched text={actor.name} term={term} />}
              detail={
                aliases.length > 0 && (
                  <>
                    aussi{' '}
                    {aliases.map((alias, i) => (
                      <span key={alias}>
                        {i > 0 && ', '}
                        <Matched text={alias} term={term} />
                      </span>
                    ))}
                  </>
                )
              }
              trailing={activities.find((a) => a.id === actor.activityId)?.name}
            />
          )
        })
      )}
    </ListPane>
  )
}

/** A blank sheet: an actor is a name first, the rest is corrected afterwards. */
export function NewActorFiche({ back }: { back: Back }) {
  return (
    <Fiche title="Nouvel acteur" back={back}>
      <ActionForm action={createActorAction} successLabel="Acteur créé">
        <TextField name="name" label="Nom" />
        <SubmitButton className="self-start">Ajouter</SubmitButton>
      </ActionForm>
    </Fiche>
  )
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`
}

/**
 * An actor carries more than a name: the aliases that resolve to it, the
 * history it can take along to its activity, and the duplicates it can be
 * merged into. Entry creates an actor as soon as a typed name matches nothing,
 * so this sheet has to be able to undo that.
 */
export function ActorFiche({
  actor,
  activities,
  others,
  listHref,
  back,
}: {
  actor: ActorEntry
  activities: { id: string; name: string }[]
  /** The actors this one can be merged into. */
  others: { id: string; name: string }[]
  listHref: string
  back: Back
}) {
  const router = useRouter()
  // The activity the actor had when the sheet opened: a changed one leaves
  // movements behind, and the reattachment then names it as former.
  const activityBefore = useRef(actor.activityId)
  const [leftBehind, setLeftBehind] = useState(0)
  const [reattaching, setReattaching] = useState<{ previousActivityId: string | null } | null>(null)
  const closeReattach = useCallback(() => setReattaching(null), [])
  const activityName = activities.find((a) => a.id === actor.activityId)?.name

  return (
    <Fiche title={actor.name} back={back}>
      <ActionForm
        action={editActorAction}
        // A changed activity that left movements behind is acknowledged here,
        // pointing at the gesture that takes them along.
        onSuccess={(state: ActorFormState) => setLeftBehind(state.leftBehind ?? 0)}
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
        <SubmitButton className="self-start">Enregistrer</SubmitButton>
      </ActionForm>
      {leftBehind > 0 && activityName && (
        <p className="mt-3 text-[12px] text-faint">
          {plural(
            leftBehind,
            'mouvement déjà déclaré ne suit pas',
            'mouvements déjà déclarés ne suivent pas',
          )}{' '}
          :{' '}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => setReattaching({ previousActivityId: activityBefore.current })}
          >
            rattacher l’historique
          </button>{' '}
          les reprend, maintenant ou plus tard.
        </p>
      )}

      <FicheSection label="Alias">
        {actor.aliases.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {actor.aliases.map((alias) => (
              <li key={alias} className="rounded-md border border-border px-2 py-0.5 text-[12.5px]">
                {alias}
              </li>
            ))}
          </ul>
        )}
        <ActionForm
          action={addAliasAction}
          className="flex-row flex-wrap items-end gap-2"
          successLabel="Alias ajouté"
        >
          <input type="hidden" name="actorId" value={actor.id} />
          <div className="min-w-48 flex-1">
            <TextField name="alias" label="Nouvel alias" placeholder="Macdo" />
          </div>
          <SubmitButton variant="outline">Ajouter</SubmitButton>
        </ActionForm>
      </FicheSection>

      {activityName && (
        <FicheSection label="Historique">
          <Button
            variant="outline"
            className="self-start"
            onClick={() => setReattaching({ previousActivityId: null })}
          >
            <Link2Icon />
            Rattacher l’historique à {activityName}
          </Button>
          <ReattachDialog
            actor={actor}
            activityName={activityName}
            previousActivityId={reattaching?.previousActivityId ?? null}
            open={reattaching !== null}
            onClose={closeReattach}
          />
        </FicheSection>
      )}

      {others.length > 0 && (
        <FicheSection label="Fusionner">
          <p className="text-[12px] text-faint">
            Tout ce qui est déclaré sous « {actor.name} » bascule sur l’acteur choisi, et « {actor.name} »
            devient un de ses alias. C’est le seul geste ici qui réécrit des mouvements déjà déclarés.
          </p>
          <ActionForm
            // The actor merged away no longer exists: the sheet follows the one
            // kept. Navigated from the action itself, not on success: the
            // refreshed page has already unmounted this sheet by then.
            action={async (prev, formData) => {
              const state = await mergeActorsAction(prev, formData)
              if (state.ok) router.push(entryHref(listHref, String(formData.get('keepId'))))
              return state
            }}
          >
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
        </FicheSection>
      )}
    </Fiche>
  )
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
