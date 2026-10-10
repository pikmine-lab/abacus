'use client'

import type { ReattachableCount } from '@abacus/core/services/actors'
import { Link2Icon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
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
import { useFormat } from '@/lib/format'

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
  const t = useTranslations('settings.categories')
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
    <ListPane search={<ListSearch value={search} onChange={setSearch} label={t('search')} />} tools={tools}>
      {categories.length === 0 ? (
        <ListEmpty>{t('empty')}</ListEmpty>
      ) : shown.length === 0 ? (
        <ListEmpty>{t('noMatch')}</ListEmpty>
      ) : (
        sections.map((section) => (
          <div key={section.label ?? ''} className="flex flex-col not-first:mt-4">
            {grouped && <GroupHeading label={section.label ?? t('noGroup')} count={section.rows.length} />}
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
  const t = useTranslations('settings')
  const editing = category !== undefined
  return (
    <Fiche title={editing ? category.name : t('categories.new')} back={back}>
      <ActionForm
        action={editing ? editCategoryAction : createCategoryAction}
        successLabel={editing ? t('categories.edited') : t('categories.created')}
      >
        {editing && <input type="hidden" name="categoryId" value={category.id} />}
        <TextField name="name" label={t('form.name')} defaultValue={category?.name ?? ''} />
        <SuggestField
          name="group"
          label={t('categories.group')}
          defaultValue={category?.groupLabel ?? ''}
          suggestions={groups}
          placeholder={t('categories.groupPlaceholder')}
        />
        <SubmitButton className="self-start">{editing ? t('form.save') : t('form.add')}</SubmitButton>
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
  const t = useTranslations('settings.actors')
  const [search, setSearch] = useState('')
  const term = fold(search.trim())
  const shown = term
    ? actors.filter(
        (a) => fold(a.name).includes(term) || a.aliases.some((alias) => fold(alias).includes(term)),
      )
    : actors

  return (
    <ListPane search={<ListSearch value={search} onChange={setSearch} label={t('search')} />} tools={tools}>
      {actors.length === 0 ? (
        <ListEmpty>{t('empty')}</ListEmpty>
      ) : shown.length === 0 ? (
        <ListEmpty>{t('noMatch')}</ListEmpty>
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
                    {t('also')}{' '}
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
  const t = useTranslations('settings')
  return (
    <Fiche title={t('actors.new')} back={back}>
      <ActionForm action={createActorAction} successLabel={t('actors.created')}>
        <TextField name="name" label={t('form.name')} />
        <SubmitButton className="self-start">{t('form.add')}</SubmitButton>
      </ActionForm>
    </Fiche>
  )
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
  const t = useTranslations('settings')
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
        successLabel={t('actors.edited')}
      >
        <input type="hidden" name="actorId" value={actor.id} />
        <TextField name="name" label={t('form.name')} defaultValue={actor.name} />
        <Field label={t('actors.activity')}>
          <FormSelect
            name="activityId"
            noneLabel={t('actors.personal')}
            defaultValue={actor.activityId ?? ''}
            options={activities.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>
        <TextField name="note" label={t('actors.note')} defaultValue={actor.note ?? ''} />
        {/* What this client does to an invoice: defaults a new invoice
            copies, which is why they belong to the payer, not the activity. */}
        <div className="grid grid-cols-2 gap-3">
          <TextField
            name="invoiceVatRate"
            label={t('actors.vatRate')}
            inputMode="decimal"
            defaultValue={actor.invoiceVatRate ?? ''}
          />
          <TextField
            name="invoiceWithholdingRate"
            label={t('actors.withholdingRate')}
            inputMode="decimal"
            defaultValue={actor.invoiceWithholdingRate ?? ''}
          />
        </div>
        <SubmitButton className="self-start">{t('form.save')}</SubmitButton>
      </ActionForm>
      {leftBehind > 0 && activityName && (
        <p className="mt-3 text-[12px] text-faint">
          {t.rich('actors.leftBehind', {
            count: leftBehind,
            link: (chunks) => (
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => setReattaching({ previousActivityId: activityBefore.current })}
              >
                {chunks}
              </button>
            ),
          })}
        </p>
      )}

      <FicheSection label={t('actors.aliases.label')}>
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
          successLabel={t('actors.aliases.added')}
        >
          <input type="hidden" name="actorId" value={actor.id} />
          <div className="min-w-48 flex-1">
            <TextField
              name="alias"
              label={t('actors.aliases.new')}
              placeholder={t('actors.aliases.placeholder')}
            />
          </div>
          <SubmitButton variant="outline">{t('form.add')}</SubmitButton>
        </ActionForm>
      </FicheSection>

      {activityName && (
        <FicheSection label={t('actors.history.label')}>
          <Button
            variant="outline"
            className="self-start"
            onClick={() => setReattaching({ previousActivityId: null })}
          >
            <Link2Icon />
            {t('actors.history.reattach', { activity: activityName })}
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
        <FicheSection label={t('actors.merge.label')}>
          <p className="text-[12px] text-faint">{t('actors.merge.description', { name: actor.name })}</p>
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
            <Field label={t('actors.merge.into')} name="keepId">
              <FormSelect
                name="keepId"
                required
                placeholder={t('actors.merge.placeholder')}
                options={others.map((a) => ({ value: a.id, label: a.name }))}
              />
            </Field>
            <SubmitButton variant="destructive" className="self-start">
              {t('actors.merge.submit')}
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
  const t = useTranslations('settings')
  const format = useFormat()
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
            {t('actors.reattach.title', { actor: actor.name, activity: activityName })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {scope === null
              ? '…'
              : scope.count === 0
                ? t('actors.reattach.nothing', { actor: actor.name, activity: activityName })
                : scope.since
                  ? t('actors.reattach.countSince', {
                      count: scope.count,
                      since: format.dateLong(scope.since),
                      activity: activityName,
                    })
                  : t('actors.reattach.count', { count: scope.count, activity: activityName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field label={t('actors.reattach.from')}>
          <DateField name="from" onValueChange={setFrom} />
        </Field>
        {state.error && <p className="text-xs text-destructive">{state.error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('form.cancel')}</AlertDialogCancel>
          <form action={reattach}>
            <input type="hidden" name="actorId" value={actor.id} />
            <input type="hidden" name="from" value={from ?? ''} />
            <input type="hidden" name="previousActivityId" value={previousActivityId ?? ''} />
            <Button type="submit" disabled={pending || !scope?.count}>
              {pending ? '…' : t('actors.reattach.submit')}
            </Button>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
