'use client'

import { CalendarClockIcon, PencilIcon, SlidersHorizontalIcon, SquarePenIcon, XIcon } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import { type LevyDraft, LevyForm, type Option } from '@/components/levy-form'
import { EmptyLine, Rows } from '@/components/page-shell'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
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
import { eur, frDate } from '@/lib/utils'

/**
 * The rules of an activity as lists that can be repaired: what it owes, the
 * figures its rules read, the thresholds it is watched against. A rule is
 * first something to read (what it takes, from when, on which source), so its
 * gestures live in the row's menu, and the panels behind them say what each
 * one does to the history.
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

const KIND_LABELS: Record<string, string> = {
  social: 'Cotisations sociales',
  income_tax: 'Impôt sur le revenu',
  vat: 'TVA',
  other: 'Autre',
}

const MEASURE_LABELS: Record<string, string> = {
  revenue: 'recettes HT',
  revenue_incl_vat: 'recettes TTC',
  expenses: 'dépenses déductibles',
  profit: 'bénéfice',
  vat_balance: 'TVA collectée − déductible',
  withholdings: 'retenues à la source',
  withholding_share: 'part des recettes retenues',
  paid: 'règlements d’une autre règle',
  amount: 'montant d’une autre règle',
  input: 'paramètre saisi',
  none: 'aucune base',
}

const PERIOD_REF_LABELS: Record<string, string> = {
  current: 'la période',
  ytd: 'l’exercice en cours',
  'year-1': 'l’exercice n−1',
  'year-2': 'l’exercice n−2',
  'rolling-12': '12 mois glissants',
}

const PERIOD_LABELS: Record<string, string> = {
  month: 'mensuelle',
  quarter: 'trimestrielle',
  half: 'semestrielle',
  year: 'annuelle',
}

const EFFECT_LABELS: Record<string, string> = {
  rate_factor: 'facteur sur le taux',
  replace_amount: 'montant de remplacement',
  coefficient: 'coefficient sur la base',
  exempt: 'exonération',
}

const STATUS_BADGE: Record<string, { label: string; variant: 'secondary' | 'outline' }> = {
  extended_by_default: { label: 'prorogée', variant: 'secondary' },
  unconfirmed: { label: 'non confirmée', variant: 'outline' },
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

function LevyRow({
  levy,
  activityId,
  categories,
  levies,
  today,
}: {
  levy: LevyEntry
  activityId: string
  categories: Option[]
  levies: Option[]
  today: string
}) {
  const [editing, setEditing] = useState(false)
  const [superseding, setSuperseding] = useState(false)
  const [closing, setClosing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [modifiers, setModifiers] = useState(false)
  const [deleteState, remove, deletePending] = useActionState(deleteLevyAction, {})

  useEffect(() => {
    if (deleteState.ok) setDeleting(false)
  }, [deleteState.ok])

  const badge = STATUS_BADGE[levy.status]
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
    <>
      <div className="flex items-center gap-3 py-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="truncate text-[12.5px]">{levy.name}</span>
            {badge && (
              <Badge variant={badge.variant} className="text-[10.5px]">
                {badge.label}
              </Badge>
            )}
          </span>
          <span className="truncate text-[11px] text-faint">
            {KIND_LABELS[levy.kind]} · {PERIOD_LABELS[levy.period]} · {validity(levy)}
            {levy.verifiedOn && ` · vérifiée le ${frDate(levy.verifiedOn)}`}
            {levy.reviewOn && (
              <span className={stale ? 'text-destructive' : undefined}>
                {' · à revérifier le '}
                {frDate(levy.reviewOn)}
              </span>
            )}
          </span>
        </div>
        <span className="shrink-0 font-mono text-[12px] text-muted-foreground tabular">
          {amountSummary(levy)}
        </span>
        <RowMenu label={levy.name}>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <PencilIcon />
            Modifier
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setSuperseding(true)}>
            <SquarePenIcon />
            Remplacer à une date
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setModifiers(true)}>
            <SlidersHorizontalIcon />
            Modificateurs
            {levy.modifiers.length > 0 && (
              <span className="ml-auto text-[11px] text-faint">{levy.modifiers.length}</span>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setClosing(true)}>
            <CalendarClockIcon />
            Clore
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <XIcon />
            Supprimer
          </DropdownMenuItem>
        </RowMenu>
      </div>

      {panel(levy.name, 'edit', editing, setEditing)}
      {panel(`Remplacer « ${levy.name} »`, 'supersede', superseding, setSuperseding)}

      <Sheet open={modifiers} onOpenChange={setModifiers}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader className="border-b border-border">
            <SheetTitle className="text-[15px]">Modificateurs de {levy.name}</SheetTitle>
            <SheetDescription className="text-[12px]">
              Ce qui change la règle pour un temps. L’éligibilité est ce que tu affirmes : l’app rappelle la
              condition, elle ne la vérifie pas.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 p-4">
            <ModifierList activityId={activityId} modifiers={levy.modifiers} />
            <ModifierForm activityId={activityId} levyId={levy.id} today={today} />
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Clore « {levy.name} »</DialogTitle>
            <DialogDescription className="text-[12px]">
              La règle ne s’applique plus après ce jour. Les périodes qu’elle couvrait gardent leurs chiffres.
            </DialogDescription>
          </DialogHeader>
          <ActionForm action={closeLevyAction} onSuccess={() => setClosing(false)} successLabel="Règle close">
            <input type="hidden" name="activityId" value={activityId} />
            <input type="hidden" name="levyId" value={levy.id} />
            <Field label="Dernier jour d’application" name="validTo">
              <DateField name="validTo" defaultValue={levy.validTo ?? today} />
            </Field>
            <SubmitButton className="self-start">Clore</SubmitButton>
          </ActionForm>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {levy.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              La règle disparaît, avec ses modificateurs. Si un règlement a déjà été déclaré dans sa
              catégorie, elle fait partie de l’histoire : clos-la plutôt.
            </AlertDialogDescription>
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
    </>
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
                {EFFECT_LABELS[modifier.effect]}
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

export function LevyRows({
  activityId,
  levies,
  categories,
  today,
}: {
  activityId: string
  levies: LevyEntry[]
  categories: Option[]
  today: string
}) {
  return (
    <Rows>
      {levies.map((levy) => (
        <LevyRow
          key={levy.id}
          levy={levy}
          activityId={activityId}
          categories={categories}
          today={today}
          // A rule reads the other rules of its activity, never itself.
          levies={levies.filter((other) => other.id !== levy.id).map((o) => ({ id: o.id, name: o.name }))}
        />
      ))}
    </Rows>
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

export function InputRows({ activityId, inputs }: { activityId: string; inputs: InputEntry[] }) {
  const [state, remove, pending] = useActionState(removeInputAction, {})
  return (
    <>
      <Rows>
        {inputs.map((input) => (
          <div key={input.id} className="flex items-center gap-3 py-2">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-mono text-[12.5px]">{input.name}</span>
              <span className="truncate text-[11px] text-faint">
                à partir du {frDate(input.validFrom)}
                {input.note && ` · ${input.note}`}
              </span>
            </div>
            <span className="shrink-0 font-mono text-[12.5px] tabular">
              {Number(input.value).toLocaleString('fr-FR', { maximumFractionDigits: 4 })}
            </span>
            <form action={remove}>
              <input type="hidden" name="activityId" value={activityId} />
              <input type="hidden" name="inputId" value={input.id} />
              <Button
                type="submit"
                variant="ghost"
                size="icon"
                disabled={pending}
                className="size-7 shrink-0 text-faint hover:text-destructive"
                aria-label={`Retirer ${input.name}`}
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

const THRESHOLD_MEASURES = [
  { value: 'revenue', label: 'Recettes HT' },
  { value: 'revenue_incl_vat', label: 'Recettes TTC' },
  { value: 'expenses', label: 'Dépenses déductibles' },
  { value: 'profit', label: 'Bénéfice' },
  { value: 'vat_balance', label: 'TVA collectée − déductible' },
  { value: 'withholdings', label: 'Retenues à la source' },
  { value: 'withholding_share', label: 'Part des recettes retenues (%)' },
]

const PERIOD_REF_OPTIONS = Object.entries(PERIOD_REF_LABELS).map(([value, label]) => ({ value, label }))

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

export function NewThresholdForm({ activityId, today }: { activityId: string; today: string }) {
  return (
    <ActionForm action={createThresholdAction} successLabel="Seuil créé">
      <input type="hidden" name="activityId" value={activityId} />
      <ThresholdFields today={today} />
      <SubmitButton className="self-start">Créer le seuil</SubmitButton>
    </ActionForm>
  )
}

function ThresholdRow({
  activityId,
  threshold,
  today,
}: {
  activityId: string
  threshold: ThresholdEntry
  today: string
}) {
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [state, remove, pending] = useActionState(removeThresholdAction, {})

  useEffect(() => {
    if (state.ok) setRemoving(false)
  }, [state.ok])

  return (
    <>
      <div className="flex items-center gap-3 py-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[12.5px]">{threshold.label}</span>
          <span className="truncate text-[11px] text-faint">
            {MEASURE_LABELS[threshold.measure]} sur {PERIOD_REF_LABELS[threshold.periodRef]} ·{' '}
            {threshold.consequence}
          </span>
        </div>
        <span className="shrink-0 font-mono text-[12px] text-muted-foreground tabular">
          {threshold.comparison === 'lte' ? '≤ ' : '≥ '}
          {Number(threshold.value).toLocaleString('fr-FR')}
        </span>
        <RowMenu label={threshold.label}>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <PencilIcon />
            Modifier
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(true)}>
            <XIcon />
            Retirer
          </DropdownMenuItem>
        </RowMenu>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{threshold.label}</DialogTitle>
          </DialogHeader>
          <ActionForm
            action={editThresholdAction}
            onSuccess={() => setEditing(false)}
            successLabel="Seuil corrigé"
          >
            <input type="hidden" name="activityId" value={activityId} />
            <input type="hidden" name="thresholdId" value={threshold.id} />
            <ThresholdFields threshold={threshold} today={today} />
            <SubmitButton className="self-start">Enregistrer</SubmitButton>
          </ActionForm>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retirer « {threshold.label} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le seuil cesse d’être surveillé. Rien d’autre ne change : un seuil alerte, il ne bascule aucun
              régime.
            </AlertDialogDescription>
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
    </>
  )
}

export function ThresholdRows({
  activityId,
  thresholds,
  today,
}: {
  activityId: string
  thresholds: ThresholdEntry[]
  today: string
}) {
  return (
    <Rows>
      {thresholds.map((threshold) => (
        <ThresholdRow key={threshold.id} activityId={activityId} threshold={threshold} today={today} />
      ))}
    </Rows>
  )
}

/** A stated figure, added from the section's own row. */
export function NewInputForm({ activityId, today }: { activityId: string; today: string }) {
  return (
    <ActionForm
      action={setInputAction}
      className="flex-row flex-wrap items-end gap-2"
      successLabel="Paramètre saisi"
    >
      <input type="hidden" name="activityId" value={activityId} />
      <Field label="Nom" name="name" className="w-44">
        <Input name="name" placeholder="contribution_base" className="h-8 font-mono text-[12.5px]" />
      </Field>
      <Field label="À partir du" name="validFrom" className="w-40">
        <DateField name="validFrom" defaultValue={today} />
      </Field>
      <Field label="Valeur" name="value" className="w-28">
        <AmountInput name="value" className="h-8" />
      </Field>
      <Field label="Note" className="w-40">
        <Input name="note" placeholder="d’où vient le chiffre" className="h-8 text-[12.5px]" />
      </Field>
      <SubmitButton variant="outline" size="sm">
        Ajouter
      </SubmitButton>
    </ActionForm>
  )
}
