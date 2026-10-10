'use client'

import { CalendarClockIcon, PencilIcon, SlidersHorizontalIcon, SquarePenIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
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
import { type Format, useFormat } from '@/lib/format'
import { LEVY_PERIOD_REFS, useLevyWords } from '@/lib/levy-words'

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
function useAmountSummary(): (levy: LevyEntry) => string {
  const t = useTranslations('regime.amount')
  const format = useFormat()
  return (levy) => {
    if (levy.amountForm === 'rate') return t('rate', { rate: format.number(levy.rate ?? 0, 3) })
    if (levy.amountForm === 'fixed')
      return levy.fixedAmount ? format.eur(levy.fixedAmount, 2) : (levy.fixedInputName ?? t('stated'))
    if (levy.amountForm === 'brackets') {
      const rows = (levy.brackets as { rows?: unknown[] } | null)?.rows?.length ?? 0
      return t('brackets', { count: rows })
    }
    if (levy.amountForm === 'elective_base') return t('elective')
    return t('nothing')
  }
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
  const t = useTranslations('regime.rules')
  const words = useLevyWords()
  const amountSummary = useAmountSummary()
  return (
    <ListPane>
      {levies.length === 0 ? (
        <ListEmpty>{t('empty')}</ListEmpty>
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
                  {words.kind(levy.kind)} · {words.period(levy.period)}
                  {stale && <span className="text-destructive"> · {t('toReview')}</span>}
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
  const t = useTranslations('regime.rules')
  const ts = useTranslations('regime.shared')
  const tm = useTranslations('regime.modifiers')
  const tp = useTranslations('common.period')
  const words = useLevyWords()
  const format = useFormat()
  const amountSummary = useAmountSummary()
  const [editing, setEditing] = useState(false)
  const [superseding, setSuperseding] = useState(false)
  const [addingModifier, setAddingModifier] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteState, remove, deletePending] = useActionState(deleteLevyAction, {})

  useEffect(() => {
    if (deleteState.ok) setDeleting(false)
  }, [deleteState.ok])

  const badge = words.status(levy.status)
  const stale = levy.reviewOn !== null && levy.reviewOn <= today
  const validity = levy.validTo
    ? tp('range', { from: format.date(levy.validFrom), to: format.date(levy.validTo) })
    : t('since', { date: format.date(levy.validFrom) })
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
            {mode === 'edit' ? t('editDescription') : t('supersedeDescription')}
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
        <Fact label={t('facts.amount')}>
          <span className="font-mono tabular">{amountSummary(levy)}</span>
        </Fact>
        <Fact label={t('facts.kind')}>{words.kind(levy.kind)}</Fact>
        <Fact label={t('facts.period')}>{words.period(levy.period)}</Fact>
        <Fact label={t('facts.validity')}>{validity}</Fact>
        {levy.sourceUrl && (
          <Fact label={t('facts.source')}>
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
        {levy.verifiedOn && <Fact label={ts('verifiedOn')}>{format.date(levy.verifiedOn)}</Fact>}
        {levy.reviewOn && (
          <Fact label={ts('reviewOn')}>
            <span className={stale ? 'text-destructive' : undefined}>{format.date(levy.reviewOn)}</span>
          </Fact>
        )}
        {levy.note && <Fact label={ts('note')}>{levy.note}</Fact>}
      </Facts>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setEditing(true)}>
          <PencilIcon />
          {t('edit')}
        </Button>
        <Button variant="outline" onClick={() => setSuperseding(true)}>
          <SquarePenIcon />
          {t('supersede')}
        </Button>
      </div>
      {panel(levy.name, 'edit', editing, setEditing)}
      {panel(t('supersedeTitle', { name: levy.name }), 'supersede', superseding, setSuperseding)}

      <FicheSection label={tm('label')}>
        <p className="text-[12px] text-faint">{tm('description')}</p>
        <ModifierList activityId={activityId} modifiers={levy.modifiers} />
        <Button variant="outline" className="self-start" onClick={() => setAddingModifier(true)}>
          <SlidersHorizontalIcon />
          {tm('add')}
        </Button>
        <Sheet open={addingModifier} onOpenChange={setAddingModifier}>
          <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
            <SheetHeader className="border-b border-border">
              <SheetTitle className="text-[15px]">{tm('sheetTitle', { name: levy.name })}</SheetTitle>
            </SheetHeader>
            <div className="p-4">
              <ModifierForm activityId={activityId} levyId={levy.id} today={today} />
            </div>
          </SheetContent>
        </Sheet>
      </FicheSection>

      <FicheSection label={t('close.label')}>
        <p className="text-[12px] text-faint">{t('close.description')}</p>
        <ActionForm
          action={closeLevyAction}
          className="flex-row flex-wrap items-end gap-2"
          successLabel={t('close.success')}
        >
          <input type="hidden" name="activityId" value={activityId} />
          <input type="hidden" name="levyId" value={levy.id} />
          <Field label={t('close.lastDay')} name="validTo" className="w-52">
            <DateField name="validTo" defaultValue={levy.validTo ?? today} />
          </Field>
          <SubmitButton variant="outline">
            <CalendarClockIcon />
            {t('close.label')}
          </SubmitButton>
        </ActionForm>
      </FicheSection>

      <FicheSection label={ts('delete')}>
        <p className="text-[12px] text-faint">{t('delete.description')}</p>
        <Button variant="destructive" className="self-start" onClick={() => setDeleting(true)}>
          <XIcon />
          {ts('delete')}
        </Button>
        <AlertDialog open={deleting} onOpenChange={setDeleting}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('delete.title', { name: levy.name })}</AlertDialogTitle>
              <AlertDialogDescription>{t('delete.confirm')}</AlertDialogDescription>
            </AlertDialogHeader>
            {deleteState.error && <p className="text-xs text-destructive">{deleteState.error}</p>}
            <AlertDialogFooter>
              <AlertDialogCancel>{ts('cancel')}</AlertDialogCancel>
              <form action={remove}>
                <input type="hidden" name="activityId" value={activityId} />
                <input type="hidden" name="levyId" value={levy.id} />
                <Button type="submit" variant="destructive" disabled={deletePending}>
                  {deletePending ? '…' : ts('delete')}
                </Button>
              </form>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </FicheSection>
    </Fiche>
  )
}

function duration(
  modifier: ModifierEntry,
  t: ReturnType<typeof useTranslations<'regime.modifiers'>>,
  format: Format,
): string {
  if (modifier.durationMonths) return t('months', { count: modifier.durationMonths })
  if (modifier.durationPeriods) return t('periods', { count: modifier.durationPeriods })
  if (modifier.endsOn) return t('until', { date: format.date(modifier.endsOn) })
  return t('durations.none')
}

function ModifierList({ activityId, modifiers }: { activityId: string; modifiers: ModifierEntry[] }) {
  const t = useTranslations('regime.modifiers')
  const words = useLevyWords()
  const format = useFormat()
  const [state, remove, pending] = useActionState(removeModifierAction, {})
  if (modifiers.length === 0) return <EmptyLine>{t('empty')}</EmptyLine>
  return (
    <>
      <Rows>
        {modifiers.map((modifier) => (
          <div key={modifier.id} className="flex items-center gap-3 py-2">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[12.5px]">{modifier.label}</span>
              <span className="truncate text-[11px] text-faint">
                {words.effect(modifier.effect)}
                {modifier.value && ` ${format.number(modifier.value, 3)}`} ·{' '}
                {modifier.startsOn ? t('fromDate', { date: format.date(modifier.startsOn) }) : t('fromStart')}{' '}
                · {duration(modifier, t, format)}
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
                aria-label={t('removeLabel', { label: modifier.label })}
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

const EFFECTS = ['rate_factor', 'replace_amount', 'coefficient', 'exempt'] as const

const DURATIONS = ['none', 'months', 'periods', 'endsOn'] as const

const MODIFIER_STATUSES = ['confirmed', 'extended_by_default', 'unconfirmed'] as const

function ModifierForm({ activityId, levyId, today }: { activityId: string; levyId: string; today: string }) {
  const t = useTranslations('regime.modifiers')
  const ts = useTranslations('regime.shared')
  const [effect, setEffect] = useState('rate_factor')
  const [durationKind, setDurationKind] = useState('none')
  return (
    <ActionForm action={addModifierAction} successLabel={t('success')}>
      <input type="hidden" name="activityId" value={activityId} />
      <input type="hidden" name="levyId" value={levyId} />
      <TextField name="label" label={t('claim')} placeholder={t('claimPlaceholder')} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('effect')} name="effect">
          <FormSelect
            name="effect"
            required
            defaultValue={effect}
            options={EFFECTS.map((value) => ({ value, label: t(`effects.${value}`) }))}
            onValueChange={setEffect}
          />
        </Field>
        {effect !== 'exempt' && (
          <Field label={effect === 'replace_amount' ? t('amount') : ts('value')} name="value">
            <Input
              name="value"
              inputMode="decimal"
              autoComplete="off"
              placeholder={effect === 'replace_amount' ? '80' : t('valuePlaceholder')}
              className="text-right font-mono tabular"
            />
          </Field>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('startsOn')}>
          <DateField name="startsOn" />
        </Field>
        <Field label={t('duration')}>
          <FormSelect
            name="durationKind"
            defaultValue={durationKind}
            options={DURATIONS.map((value) => ({ value, label: t(`durations.${value}`) }))}
            onValueChange={setDurationKind}
          />
        </Field>
      </div>
      {(durationKind === 'months' || durationKind === 'periods') && (
        <Field label={durationKind === 'months' ? t('monthCount') : t('periodCount')} name="durationValue">
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
        <Field label={t('endsOn')} name="endsOn">
          <DateField name="endsOn" defaultValue={today} />
        </Field>
      )}
      <TextField name="condition" label={t('condition')} placeholder={t('conditionPlaceholder')} />
      <div className="grid grid-cols-2 gap-3">
        <TextField name="modifierSourceUrl" label={ts('sourceUrl')} placeholder="https://…" />
        <Field label={ts('verifiedOn')}>
          <DateField name="modifierVerifiedOn" defaultValue={today} />
        </Field>
      </div>
      <Field label={ts('status')}>
        <FormSelect
          name="modifierStatus"
          defaultValue="confirmed"
          options={MODIFIER_STATUSES.map((value) => ({ value, label: t(`statuses.${value}`) }))}
        />
      </Field>
      <SubmitButton className="self-start">{ts('add')}</SubmitButton>
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
  const t = useTranslations('regime.inputs')
  const format = useFormat()
  return (
    <ListPane>
      {inputs.length === 0 ? (
        <ListEmpty>{t('empty')}</ListEmpty>
      ) : (
        inputs.map((input) => (
          <EntryRow
            key={input.id}
            href={entryHref(listHref, input.id)}
            selected={selectionOf(selection, input.id)}
            title={<span className="font-mono">{input.name}</span>}
            detail={t('from', { date: format.date(input.validFrom) })}
            trailing={<span className="font-mono tabular">{format.number(input.value, 4)}</span>}
          />
        ))
      )}
    </ListPane>
  )
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
  const t = useTranslations('regime.inputs')
  const ts = useTranslations('regime.shared')
  const format = useFormat()
  const [state, remove, pending] = useActionState(removeInputAction, {})
  return (
    <Fiche title={input.name} back={back}>
      <Facts>
        <Fact label={ts('value')}>
          <span className="font-mono tabular">{format.number(input.value, 4)}</span>
        </Fact>
        <Fact label={ts('from')}>{format.date(input.validFrom)}</Fact>
        {input.note && <Fact label={ts('note')}>{input.note}</Fact>}
      </Facts>
      <FicheSection label={ts('remove')}>
        <form action={remove} className="flex flex-col gap-2">
          <input type="hidden" name="activityId" value={activityId} />
          <input type="hidden" name="inputId" value={input.id} />
          <Button type="submit" variant="destructive" disabled={pending} className="self-start">
            <XIcon />
            {pending ? '…' : t('removeNamed', { name: input.name })}
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
  const t = useTranslations('regime.inputs')
  const ts = useTranslations('regime.shared')
  return (
    <Fiche title={t('newTitle')} back={back}>
      <ActionForm action={setInputAction} successLabel={t('success')}>
        <input type="hidden" name="activityId" value={activityId} />
        <Field label={ts('name')} name="name">
          <Input name="name" placeholder="contribution_base" className="font-mono" autoComplete="off" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={ts('from')} name="validFrom">
            <DateField name="validFrom" defaultValue={today} />
          </Field>
          <Field label={ts('value')} name="value">
            <AmountInput name="value" />
          </Field>
        </div>
        <Field label={ts('note')}>
          <Input name="note" placeholder={t('notePlaceholder')} />
        </Field>
        <SubmitButton className="self-start">{ts('add')}</SubmitButton>
      </ActionForm>
    </Fiche>
  )
}

const THRESHOLD_MEASURES = [
  'revenue',
  'revenue_incl_vat',
  'expenses',
  'profit',
  'vat_balance',
  'withholdings',
  'withholding_share',
] as const

const COMPARISONS = ['lte', 'gte'] as const

/** Shared by the entry panel and the correction dialog: a threshold's own fields. */
function ThresholdFields({ threshold, today }: { threshold?: ThresholdEntry; today: string }) {
  const t = useTranslations('regime.thresholds')
  const ts = useTranslations('regime.shared')
  const tm = useTranslations('regime.measureOptions')
  const words = useLevyWords()
  return (
    <>
      <TextField
        name="label"
        label={t('label')}
        defaultValue={threshold?.label ?? ''}
        placeholder={t('labelPlaceholder')}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label={ts('measure')} name="measure">
          <FormSelect
            name="measure"
            required
            defaultValue={threshold?.measure ?? 'revenue'}
            options={THRESHOLD_MEASURES.map((value) => ({ value, label: tm(value) }))}
          />
        </Field>
        <Field label={ts('readOn')}>
          <FormSelect
            name="periodRef"
            defaultValue={threshold?.periodRef ?? 'ytd'}
            options={LEVY_PERIOD_REFS.map((value) => ({ value, label: words.periodRef(value) }))}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('comparison')}>
          <FormSelect
            name="comparison"
            defaultValue={threshold?.comparison ?? 'lte'}
            options={COMPARISONS.map((value) => ({ value, label: t(`comparisons.${value}`) }))}
          />
        </Field>
        <Field label={ts('value')} name="value">
          <AmountInput name="value" defaultValue={threshold?.value ?? ''} />
        </Field>
      </div>
      <TextField
        name="consequence"
        label={t('consequence')}
        defaultValue={threshold?.consequence ?? ''}
        placeholder={t('consequencePlaceholder')}
      />
      <TextField
        name="sourceUrl"
        label={ts('sourceUrl')}
        defaultValue={threshold?.sourceUrl ?? ''}
        placeholder="https://…"
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('verifiedOn')}>
          <DateField name="verifiedOn" defaultValue={threshold?.verifiedOn ?? today} />
        </Field>
        <Field label={ts('reviewOn')}>
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
  const t = useTranslations('regime.thresholds')
  const ts = useTranslations('regime.shared')
  const words = useLevyWords()
  return (
    <ListPane>
      {thresholds.length === 0 ? (
        <ListEmpty>{t('empty')}</ListEmpty>
      ) : (
        thresholds.map((threshold) => (
          <EntryRow
            key={threshold.id}
            href={entryHref(listHref, threshold.id)}
            selected={selectionOf(selection, threshold.id)}
            title={threshold.label}
            detail={ts('measureOver', {
              measure: words.measure(threshold.measure),
              period: words.periodRef(threshold.periodRef),
            })}
            trailing={
              <span className="font-mono tabular">
                {threshold.comparison === 'lte' ? '≤ ' : '≥ '}
                {words.thresholdValue(threshold.measure, threshold.value)}
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
  const t = useTranslations('regime.thresholds')
  const ts = useTranslations('regime.shared')
  const [removing, setRemoving] = useState(false)
  const [state, remove, pending] = useActionState(removeThresholdAction, {})

  useEffect(() => {
    if (state.ok) setRemoving(false)
  }, [state.ok])

  return (
    <Fiche title={threshold.label} back={back}>
      <ActionForm action={editThresholdAction} successLabel={t('edited')}>
        <input type="hidden" name="activityId" value={activityId} />
        <input type="hidden" name="thresholdId" value={threshold.id} />
        <ThresholdFields threshold={threshold} today={today} />
        <SubmitButton className="self-start">{ts('save')}</SubmitButton>
      </ActionForm>

      <FicheSection label={ts('remove')}>
        <p className="text-[12px] text-faint">{t('removeDescription')}</p>
        <Button variant="destructive" className="self-start" onClick={() => setRemoving(true)}>
          <XIcon />
          {ts('remove')}
        </Button>
        <AlertDialog open={removing} onOpenChange={setRemoving}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('removeTitle', { label: threshold.label })}</AlertDialogTitle>
              <AlertDialogDescription>{t('removeConfirm')}</AlertDialogDescription>
            </AlertDialogHeader>
            {state.error && <p className="text-xs text-destructive">{state.error}</p>}
            <AlertDialogFooter>
              <AlertDialogCancel>{ts('cancel')}</AlertDialogCancel>
              <form action={remove}>
                <input type="hidden" name="activityId" value={activityId} />
                <input type="hidden" name="thresholdId" value={threshold.id} />
                <Button type="submit" variant="destructive" disabled={pending}>
                  {pending ? '…' : ts('remove')}
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
  const t = useTranslations('regime.thresholds')
  return (
    <Fiche title={t('newTitle')} back={back}>
      <ActionForm action={createThresholdAction} successLabel={t('created')}>
        <input type="hidden" name="activityId" value={activityId} />
        <ThresholdFields today={today} />
        <SubmitButton className="self-start">{t('create')}</SubmitButton>
      </ActionForm>
    </Fiche>
  )
}
