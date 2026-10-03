'use client'

import { CalendarClockIcon, PencilIcon, SlidersHorizontalIcon, SquarePenIcon, XIcon } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import { type LevyDraft, LevyForm, type Option } from '@/components/levy-form'
import {
  EntryRow,
  Fiche,
  FicheSection,
  ListEmpty,
  ListPane,
  type Selection,
  selectionOf,
} from '@/components/master-detail'
import { EmptyLine, Rows } from '@/components/page-shell'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  addModifierAction,
  closeLevyAction,
  createThresholdAction,
  deleteLevyAction,
  editThresholdAction,
  removeInputAction,
  removeModifierAction,
  removeThresholdAction,
  setInputAction,
} from '@/lib/actions'
import { entryHref } from '@/lib/entry-href'
import {
  LEVY_EFFECT_LABEL,
  LEVY_KIND_LABEL,
  LEVY_MEASURE_LABEL,
  LEVY_PERIOD_LABEL,
  LEVY_PERIOD_REF_LABEL,
  LEVY_STATUS_BADGE,
  thresholdValue,
} from '@/lib/levy-words'
import { eur, frDate } from '@/lib/utils'

/**
 * The rules of an activity as lists that can be repaired: what it owes, the
 * figures its rules read, the thresholds it is watched against. Each is a list
 * beside the sheet of the entry picked from it, and each gesture in a sheet
 * says what it does to the history.
 */

export interface ModifierEntry {
  id: string
  label: string
  effect: string
  value: string | null
  startsOn: string | null
  durationMonths: number | null
  durationPeriods: number | null
  endsOn: string | null
  condition: string | null
  status: string
}

export interface LevyEntry extends LevyDraft {
  modifiers: ModifierEntry[]
}

export interface InputEntry {
  id: string
  name: string
  validFrom: string
  value: string
  note: string | null
}

export interface ThresholdEntry {
  id: string
  label: string
  measure: string
  periodRef: string
  comparison: string
  value: string
  consequence: string
  sourceUrl: string | null
  verifiedOn: string | null
  reviewOn: string | null
}

/** What the rule takes, in the shortest form that is still checkable. */
function amountSummary(levy: LevyEntry): string {
  if (levy.amountForm === 'rate') return `${Number(levy.rate ?? 0).toLocaleString('fr-FR')} %`
  if (levy.amountForm === 'fixed')
    return levy.fixedAmount ? eur(levy.fixedAmount, 2) : (levy.fixedInputName ?? 'saisi')
  if (levy.amountForm === 'brackets') {
    const rows = (levy.brackets as { rows?: unknown[] } | null)?.rows?.length ?? 0
    return `barème, ${rows} tranche${rows > 1 ? 's' : ''}`
  }
  if (levy.amountForm === 'elective_base') return 'base choisie'
  return 'rien à payer'
}

function validity(levy: LevyEntry): string {
  return levy.validTo
    ? `du ${frDate(levy.validFrom)} au ${frDate(levy.validTo)}`
    : `depuis le ${frDate(levy.validFrom)}`
}

/**
 * The rules, read by what they take: the amount at the end of the row, the
 * kind and the period under the name, and a review date gone by in red.
 */
export function LevyList({
  levies,
  listHref,
  selection,
  today,
}: {
  levies: LevyEntry[]
  listHref: string
  selection: Selection
  today: string
}) {
  return (
    <ListPane>
      {levies.length === 0 ? (
        <ListEmpty>Aucune règle. Sans elles, les charges de l’activité ne se calculent pas.</ListEmpty>
      ) : (
        levies.map((levy) => {
          const stale = levy.reviewOn !== null && levy.reviewOn <= today
          return (
            <EntryRow
              key={levy.id}
              href={entryHref(listHref, levy.id)}
              selected={selectionOf(selection, levy.id)}
              muted={levy.validTo !== null && levy.validTo < today}
              title={levy.name}
              detail={
                <>
                  {LEVY_KIND_LABEL[levy.kind]} · {LEVY_PERIOD_LABEL[levy.period]}
                  {stale && <span className="text-destructive"> · à revérifier</span>}
                </>
              }
              trailing={<span className="font-mono tabular">{amountSummary(levy)}</span>}
            />
          )
        })
      )}
    </ListPane>
  )
}

/** One fact of a sheet that reads before it is acted on: its name, then its value. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-faint">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  )
}

function Facts({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-[12.5px]">{children}</dl>
}

/** The address a source lives at, without the scheme: enough to recognise it. */
function sourceHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * A rule's sheet. A rule is first something to read (what it takes, from
 * when, on which source), so the sheet states it before offering anything;
 * correcting and replacing it open the full form in a panel, because a rule
 * has seven blocks of fields. Its modifiers, closing and deleting follow.
 */
export function LevyFiche({
  levy,
  activityId,
  categories,
  levies,
  today,
  back,
}: {
  levy: LevyEntry
  activityId: string
  categories: Option[]
  /** The other rules of the activity, which this one may read. */
  levies: Option[]
  today: string
  back: { href: string; label: string }
}) {
  const [editing, setEditing] = useState(false)
  const [superseding, setSuperseding] = useState(false)
  const [addingModifier, setAddingModifier] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteState, remove, deletePending] = useActionState(deleteLevyAction, {})

  useEffect(() => {
    if (deleteState.ok) setDeleting(false)
  }, [deleteState.ok])

  const badge = LEVY_STATUS_BADGE[levy.status]
  const stale = levy.reviewOn !== null && levy.reviewOn <= today
  const panel = (
    title: string,
    mode: 'edit' | 'supersede',
    open: boolean,
    onOpenChange: (v: boolean) => void,
  ) => (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="text-[15px]">{title}</SheetTitle>
          <SheetDescription className="text-[12px]">
            {mode === 'edit'
              ? 'Corrige ce qui a été mal saisi. Une valeur qui a changé à une date se remplace, elle ne se corrige pas.'
              : 'La règle actuelle se clôt la veille, celle-ci prend la suite avec ses nouvelles valeurs.'}
          </SheetDescription>
        </SheetHeader>
        <div className="p-4">
          <LevyForm
            activityId={activityId}
            categories={categories}
            levies={levies}
            today={today}
            draft={levy}
            mode={mode}
            onDone={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  )

  return (
    <Fiche
      title={levy.name}
      badge={
        badge && (
          <Badge variant={badge.variant} className="text-[11px]">
            {badge.label}
          </Badge>
        )
      }
      back={back}
    >
      <Facts>
        <Fact label="Montant">
          <span className="font-mono tabular">{amountSummary(levy)}</span>
        </Fact>
        <Fact label="Nature">{LEVY_KIND_LABEL[levy.kind]}</Fact>
        <Fact label="Période">{LEVY_PERIOD_LABEL[levy.period]}</Fact>
        <Fact label="Validité">{validity(levy)}</Fact>
        {levy.sourceUrl && (
          <Fact label="Source">
            <a
              href={levy.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-border underline-offset-2 hover:text-primary hover:decoration-primary"
            >
              {sourceHost(levy.sourceUrl)}
            </a>
          </Fact>
        )}
        {levy.verifiedOn && <Fact label="Vérifiée le">{frDate(levy.verifiedOn)}</Fact>}
        {levy.reviewOn && (
          <Fact label="À revérifier le">
            <span className={stale ? 'text-destructive' : undefined}>{frDate(levy.reviewOn)}</span>
          </Fact>
        )}
        {levy.note && <Fact label="Note">{levy.note}</Fact>}
      </Facts>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setEditing(true)}>
          <PencilIcon />
          Modifier
        </Button>
        <Button variant="outline" onClick={() => setSuperseding(true)}>
          <SquarePenIcon />
          Remplacer à une date
        </Button>
      </div>
      {panel(levy.name, 'edit', editing, setEditing)}
      {panel(`Remplacer « ${levy.name} »`, 'supersede', superseding, setSuperseding)}

      <FicheSection label="Modificateurs">
        <p className="text-[12px] text-faint">
          Ce qui change la règle pour un temps. L’éligibilité est ce que tu affirmes : l’app rappelle la
          condition, elle ne la vérifie pas.
        </p>
        <ModifierList activityId={activityId} modifiers={levy.modifiers} />
        <Button variant="outline" className="self-start" onClick={() => setAddingModifier(true)}>
          <SlidersHorizontalIcon />
          Ajouter un modificateur
        </Button>
        <Sheet open={addingModifier} onOpenChange={setAddingModifier}>
          <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
            <SheetHeader className="border-b border-border">
              <SheetTitle className="text-[15px]">Modificateur de {levy.name}</SheetTitle>
            </SheetHeader>
            <div className="p-4">
              <ModifierForm activityId={activityId} levyId={levy.id} today={today} />
            </div>
          </SheetContent>
        </Sheet>
      </FicheSection>

      <FicheSection label="Clore">
        <p className="text-[12px] text-faint">
          La règle ne s’applique plus après ce jour. Les périodes qu’elle couvrait gardent leurs chiffres.
        </p>
        <ActionForm
          action={closeLevyAction}
          className="flex-row flex-wrap items-end gap-2"
          successLabel="Règle close"
        >
          <input type="hidden" name="activityId" value={activityId} />
          <input type="hidden" name="levyId" value={levy.id} />
          <Field label="Dernier jour d’application" name="validTo" className="w-52">
            <DateField name="validTo" defaultValue={levy.validTo ?? today} />
          </Field>
          <SubmitButton variant="outline">
            <CalendarClockIcon />
            Clore
          </SubmitButton>
        </ActionForm>
      </FicheSection>

      <FicheSection label="Supprimer">
        <p className="text-[12px] text-faint">
          La règle disparaît, avec ses modificateurs. Si un règlement a déjà été déclaré dans sa catégorie,
          elle fait partie de l’histoire : clos-la plutôt.
        </p>
        <Button variant="destructive" className="self-start" onClick={() => setDeleting(true)}>
          <XIcon />
          Supprimer
        </Button>
        <AlertDialog open={deleting} onOpenChange={setDeleting}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer « {levy.name} » ?</AlertDialogTitle>
              <AlertDialogDescription>La règle disparaît, avec ses modificateurs.</AlertDialogDescription>
            </AlertDialogHeader>
            {deleteState.error && <p className="text-xs text-destructive">{deleteState.error}</p>}
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <form action={remove}>
                <input type="hidden" name="activityId" value={activityId} />
                <input type="hidden" name="levyId" value={levy.id} />
                <Button type="submit" variant="destructive" disabled={deletePending}>
                  {deletePending ? '…' : 'Supprimer'}
                </Button>
              </form>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </FicheSection>
    </Fiche>
  )
}

function duration(modifier: ModifierEntry): string {
  if (modifier.durationMonths) return `${modifier.durationMonths} mois`
  if (modifier.durationPeriods) return `${modifier.durationPeriods} périodes`
  if (modifier.endsOn) return `jusqu’au ${frDate(modifier.endsOn)}`
  return 'sans fin'
}

function ModifierList({ activityId, modifiers }: { activityId: string; modifiers: ModifierEntry[] }) {
  const [state, remove, pending] = useActionState(removeModifierAction, {})
  if (modifiers.length === 0) return <EmptyLine>Aucun modificateur.</EmptyLine>
  return (
    <>
      <Rows>
        {modifiers.map((modifier) => (
          <div key={modifier.id} className="flex items-center gap-3 py-2">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[12.5px]">{modifier.label}</span>
              <span className="truncate text-[11px] text-faint">
                {LEVY_EFFECT_LABEL[modifier.effect]}
                {modifier.value && ` ${Number(modifier.value).toLocaleString('fr-FR')}`} ·{' '}
                {modifier.startsOn ? `dès le ${frDate(modifier.startsOn)}` : 'dès le début'} ·{' '}
                {duration(modifier)}
                {modifier.condition && ` · ${modifier.condition}`}
              </span>
            </div>
            <form action={remove}>
              <input type="hidden" name="activityId" value={activityId} />
              <input type="hidden" name="modifierId" value={modifier.id} />
              <Button
                type="submit"
                variant="ghost"
                size="icon"
                disabled={pending}
                className="size-7 shrink-0 text-faint hover:text-destructive"
                aria-label={`Retirer ${modifier.label}`}
              >
                <XIcon className="size-3.5" />
              </Button>
            </form>
          </div>
        ))}
      </Rows>
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
    </>
  )
}

const EFFECTS = [
  { value: 'rate_factor', label: 'Facteur sur le taux' },
  { value: 'replace_amount', label: 'Montant de remplacement' },
  { value: 'coefficient', label: 'Coefficient sur la base' },
  { value: 'exempt', label: 'Exonération' },
]

const DURATIONS = [
  { value: 'none', label: 'sans fin' },
  { value: 'months', label: 'mois civils' },
  { value: 'periods', label: 'périodes de la règle' },
  { value: 'endsOn', label: 'jusqu’à une date' },
]

function ModifierForm({ activityId, levyId, today }: { activityId: string; levyId: string; today: string }) {
  const [effect, setEffect] = useState('rate_factor')
  const [durationKind, setDurationKind] = useState('none')
  return (
    <ActionForm action={addModifierAction} successLabel="Modificateur ajouté">
      <input type="hidden" name="activityId" value={activityId} />
      <input type="hidden" name="levyId" value={levyId} />
      <TextField name="label" label="Ce que tu affirmes" placeholder="Taux réduit de début d’activité" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Effet" name="effect">
          <FormSelect
            name="effect"
            required
            defaultValue={effect}
            options={EFFECTS}
            onValueChange={setEffect}
          />
        </Field>
        {effect !== 'exempt' && (
          <Field label={effect === 'replace_amount' ? 'Montant (€)' : 'Valeur'} name="value">
            <Input
              name="value"
              inputMode="decimal"
              autoComplete="off"
              placeholder={effect === 'replace_amount' ? '80' : '0,75'}
              className="text-right font-mono tabular"
            />
          </Field>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="À partir du (optionnel)">
          <DateField name="startsOn" />
        </Field>
        <Field label="Durée">
          <FormSelect
            name="durationKind"
            defaultValue={durationKind}
            options={DURATIONS}
            onValueChange={setDurationKind}
          />
        </Field>
      </div>
      {(durationKind === 'months' || durationKind === 'periods') && (
        <Field
          label={durationKind === 'months' ? 'Nombre de mois' : 'Nombre de périodes'}
          name="durationValue"
        >
          <Input
            name="durationValue"
            inputMode="numeric"
            autoComplete="off"
            placeholder="12"
            className="text-right font-mono tabular"
          />
        </Field>
      )}
      {durationKind === 'endsOn' && (
        <Field label="Jusqu’au" name="endsOn">
          <DateField name="endsOn" defaultValue={today} />
        </Field>
      )}
      <TextField
        name="condition"
        label="Condition rappelée à l’écran"
        placeholder="première année d’activité"
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField name="modifierSourceUrl" label="Source (URL)" placeholder="https://…" />
        <Field label="Vérifiée le">
          <DateField name="modifierVerifiedOn" defaultValue={today} />
        </Field>
      </div>
      <Field label="Statut">
        <FormSelect
          name="modifierStatus"
          defaultValue="confirmed"
          options={[
            { value: 'confirmed', label: 'Confirmé par un texte' },
            { value: 'extended_by_default', label: 'Prorogé faute de texte' },
            { value: 'unconfirmed', label: 'Non confirmé' },
          ]}
        />
      </Field>
      <SubmitButton className="self-start">Ajouter</SubmitButton>
    </ActionForm>
  )
}

/** The panel behind the "+ Règle" button: the seven blocks, on a blank rule. */
export function NewLevyForm({
  activityId,
  categories,
  levies,
  today,
}: {
  activityId: string
  categories: Option[]
  levies: Option[]
  today: string
}) {
  return <LevyForm activityId={activityId} categories={categories} levies={levies} today={today} />
}

/** The stated figures: the name a rule reads, the date it holds from, its value. */
export function InputList({
  inputs,
  listHref,
  selection,
}: {
  inputs: InputEntry[]
  listHref: string
  selection: Selection
}) {
  return (
    <ListPane>
      {inputs.length === 0 ? (
        <ListEmpty>Aucun paramètre saisi.</ListEmpty>
      ) : (
        inputs.map((input) => (
          <EntryRow
            key={input.id}
            href={entryHref(listHref, input.id)}
            selected={selectionOf(selection, input.id)}
            title={<span className="font-mono">{input.name}</span>}
            detail={`à partir du ${frDate(input.validFrom)}`}
            trailing={<span className="font-mono tabular">{figure(input.value)}</span>}
          />
        ))
      )}
    </ListPane>
  )
}

function figure(value: string): string {
  return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 4 })
}

/**
 * A stated figure's sheet. A figure that changes is stated again from a new
 * date rather than corrected, so the sheet reads it and offers only to take
 * it back.
 */
export function InputFiche({
  input,
  activityId,
  back,
}: {
  input: InputEntry
  activityId: string
  back: { href: string; label: string }
}) {
  const [state, remove, pending] = useActionState(removeInputAction, {})
  return (
    <Fiche title={input.name} back={back}>
      <Facts>
        <Fact label="Valeur">
          <span className="font-mono tabular">{figure(input.value)}</span>
        </Fact>
        <Fact label="À partir du">{frDate(input.validFrom)}</Fact>
        {input.note && <Fact label="Note">{input.note}</Fact>}
      </Facts>
      <FicheSection label="Retirer">
        <form action={remove} className="flex flex-col gap-2">
          <input type="hidden" name="activityId" value={activityId} />
          <input type="hidden" name="inputId" value={input.id} />
          <Button type="submit" variant="destructive" disabled={pending} className="self-start">
            <XIcon />
            {pending ? '…' : `Retirer ${input.name}`}
          </Button>
          {state.error && <p className="text-xs text-destructive">{state.error}</p>}
        </form>
      </FicheSection>
    </Fiche>
  )
}

/** A blank sheet for a stated figure: the name a rule will read, from when, how much. */
export function NewInputFiche({
  activityId,
  today,
  back,
}: {
  activityId: string
  today: string
  back: { href: string; label: string }
}) {
  return (
    <Fiche title="Nouveau paramètre" back={back}>
      <ActionForm action={setInputAction} successLabel="Paramètre saisi">
        <input type="hidden" name="activityId" value={activityId} />
        <Field label="Nom" name="name">
          <Input name="name" placeholder="contribution_base" className="font-mono" autoComplete="off" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="À partir du" name="validFrom">
            <DateField name="validFrom" defaultValue={today} />
          </Field>
          <Field label="Valeur" name="value">
            <AmountInput name="value" />
          </Field>
        </div>
        <Field label="Note">
          <Input name="note" placeholder="d’où vient le chiffre" />
        </Field>
        <SubmitButton className="self-start">Ajouter</SubmitButton>
      </ActionForm>
    </Fiche>
  )
}

const THRESHOLD_MEASURES = [
  { value: 'revenue', label: 'Recettes HT' },
  { value: 'revenue_incl_vat', label: 'Recettes TTC' },
  { value: 'expenses', label: 'Dépenses déductibles' },
  { value: 'profit', label: 'Bénéfice' },
  { value: 'vat_balance', label: 'TVA collectée − déductible' },
  { value: 'withholdings', label: 'Retenues à la source' },
  { value: 'withholding_share', label: 'Part des recettes retenues (%)' },
]

const PERIOD_REF_OPTIONS = Object.entries(LEVY_PERIOD_REF_LABEL).map(([value, label]) => ({ value, label }))

const COMPARISONS = [
  { value: 'lte', label: 'tant que la mesure reste au plus à' },
  { value: 'gte', label: 'tant que la mesure reste au moins à' },
]

/** Shared by the entry panel and the correction dialog: a threshold's own fields. */
function ThresholdFields({ threshold, today }: { threshold?: ThresholdEntry; today: string }) {
  return (
    <>
      <TextField
        name="label"
        label="Libellé"
        defaultValue={threshold?.label ?? ''}
        placeholder="Franchise de TVA"
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mesure" name="measure">
          <FormSelect
            name="measure"
            required
            defaultValue={threshold?.measure ?? 'revenue'}
            options={THRESHOLD_MEASURES}
          />
        </Field>
        <Field label="Lue sur">
          <FormSelect
            name="periodRef"
            defaultValue={threshold?.periodRef ?? 'ytd'}
            options={PERIOD_REF_OPTIONS}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Comparaison">
          <FormSelect name="comparison" defaultValue={threshold?.comparison ?? 'lte'} options={COMPARISONS} />
        </Field>
        <Field label="Valeur" name="value">
          <AmountInput name="value" defaultValue={threshold?.value ?? ''} />
        </Field>
      </div>
      <TextField
        name="consequence"
        label="Ce qui change au-delà"
        defaultValue={threshold?.consequence ?? ''}
        placeholder="La TVA devient due dès le dépassement"
      />
      <TextField
        name="sourceUrl"
        label="Source (URL)"
        defaultValue={threshold?.sourceUrl ?? ''}
        placeholder="https://…"
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vérifié le">
          <DateField name="verifiedOn" defaultValue={threshold?.verifiedOn ?? today} />
        </Field>
        <Field label="À revérifier le">
          <DateField name="reviewOn" defaultValue={threshold?.reviewOn ?? undefined} />
        </Field>
      </div>
    </>
  )
}

/** The thresholds, read by what they watch and the value they are set at. */
export function ThresholdList({
  thresholds,
  listHref,
  selection,
}: {
  thresholds: ThresholdEntry[]
  listHref: string
  selection: Selection
}) {
  return (
    <ListPane>
      {thresholds.length === 0 ? (
        <ListEmpty>Aucun seuil surveillé.</ListEmpty>
      ) : (
        thresholds.map((threshold) => (
          <EntryRow
            key={threshold.id}
            href={entryHref(listHref, threshold.id)}
            selected={selectionOf(selection, threshold.id)}
            title={threshold.label}
            detail={`${LEVY_MEASURE_LABEL[threshold.measure]} sur ${LEVY_PERIOD_REF_LABEL[threshold.periodRef]}`}
            trailing={
              <span className="font-mono tabular">
                {threshold.comparison === 'lte' ? '≤ ' : '≥ '}
                {thresholdValue(threshold.measure, threshold.value)}
              </span>
            }
          />
        ))
      )}
    </ListPane>
  )
}

/**
 * A threshold's sheet: its own fields, corrected in place, and taking it
 * back. What changes beyond it is a sentence the user wrote, so the form is
 * the reading.
 */
export function ThresholdFiche({
  threshold,
  activityId,
  today,
  back,
}: {
  threshold: ThresholdEntry
  activityId: string
  today: string
  back: { href: string; label: string }
}) {
  const [removing, setRemoving] = useState(false)
  const [state, remove, pending] = useActionState(removeThresholdAction, {})

  useEffect(() => {
    if (state.ok) setRemoving(false)
  }, [state.ok])

  return (
    <Fiche title={threshold.label} back={back}>
      <ActionForm action={editThresholdAction} successLabel="Seuil corrigé">
        <input type="hidden" name="activityId" value={activityId} />
        <input type="hidden" name="thresholdId" value={threshold.id} />
        <ThresholdFields threshold={threshold} today={today} />
        <SubmitButton className="self-start">Enregistrer</SubmitButton>
      </ActionForm>

      <FicheSection label="Retirer">
        <p className="text-[12px] text-faint">
          Le seuil cesse d’être surveillé. Rien d’autre ne change : un seuil alerte, il ne bascule aucun
          régime.
        </p>
        <Button variant="destructive" className="self-start" onClick={() => setRemoving(true)}>
          <XIcon />
          Retirer
        </Button>
        <AlertDialog open={removing} onOpenChange={setRemoving}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Retirer « {threshold.label} » ?</AlertDialogTitle>
              <AlertDialogDescription>Le seuil cesse d’être surveillé.</AlertDialogDescription>
            </AlertDialogHeader>
            {state.error && <p className="text-xs text-destructive">{state.error}</p>}
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <form action={remove}>
                <input type="hidden" name="activityId" value={activityId} />
                <input type="hidden" name="thresholdId" value={threshold.id} />
                <Button type="submit" variant="destructive" disabled={pending}>
                  {pending ? '…' : 'Retirer'}
                </Button>
              </form>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </FicheSection>
    </Fiche>
  )
}

/** A blank sheet for a threshold: a measure, a value, and the sentence that says what changes beyond. */
export function NewThresholdFiche({
  activityId,
  today,
  back,
}: {
  activityId: string
  today: string
  back: { href: string; label: string }
}) {
  return (
    <Fiche title="Nouveau seuil" back={back}>
      <ActionForm action={createThresholdAction} successLabel="Seuil créé">
        <input type="hidden" name="activityId" value={activityId} />
        <ThresholdFields today={today} />
        <SubmitButton className="self-start">Créer le seuil</SubmitButton>
      </ActionForm>
    </Fiche>
  )
}
