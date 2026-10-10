'use client'

import { PlusIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { createLevyAction, editLevyAction, supersedeLevyAction } from '@/lib/actions'
import { useFormat } from '@/lib/format'
import { LEVY_PERIOD_REFS, type LevyWords, useLevyWords } from '@/lib/levy-words'

/**
 * A rule of a regime, in the seven blocks it is made of: identity, base,
 * amount, schedule, regularisation, settlement (its modifiers have their own
 * panel). Nothing here decides what a rule may say: the service does, and this
 * form only asks for the fields the shape it is building actually uses, so an
 * empty field is never a value.
 *
 * The tables (brackets, elective bounds, fixed dates, credits) are edited row
 * by row and travel as parallel lists, the way a financing schedule does: raw
 * JSON in a textarea would put the burden of a syntax on the person typing a
 * bracket read off an official page.
 */

export interface Option {
  id: string
  name: string
}

/** A rule being corrected or replaced, flattened for the fields. */
export interface LevyDraft {
  id: string
  name: string
  kind: string
  validFrom: string
  validTo: string | null
  sourceUrl: string | null
  verifiedOn: string | null
  reviewOn: string | null
  status: string
  baseMeasure: string
  baseLevyId: string | null
  baseInputName: string | null
  basePeriodRef: string
  baseCoefficient: string | null
  baseAbatement: unknown
  baseAddBackLevyIds: string[] | null
  baseFloor: string | null
  baseCap: string | null
  baseCredits: unknown
  baseScale: string
  amountForm: string
  rate: string | null
  brackets: unknown
  elective: unknown
  fixedAmount: string | null
  fixedInputName: string | null
  fixedCredit: string | null
  creditInputName: string | null
  period: string
  due: unknown
  declarationLagMonths: number | null
  firstDueAfterDays: number | null
  skipPeriods: unknown
  regularization: string
  regularizationParams: unknown
  settlementCategoryId: string | null
  deductible: boolean
  passThrough: boolean
  note: string | null
}

const KINDS = ['social', 'income_tax', 'vat', 'other'] as const

const STATUSES = ['confirmed', 'extended_by_default', 'unconfirmed'] as const

const MEASURES = [
  'revenue',
  'revenue_incl_vat',
  'expenses',
  'profit',
  'vat_balance',
  'withholdings',
  'paid',
  'amount',
  'input',
  'none',
] as const

const SCALES = ['none', 'per_month', 'per_period', 'annualized'] as const

const PERIODS = ['month', 'quarter', 'half', 'year'] as const

const REGULARIZATIONS = ['none', 'annual_deadzone', 'provisional_then_settled'] as const

const CREDIT_SOURCES = ['withholdings', 'paid', 'amount'] as const

/** How many periods a fiscal year holds, for the ones a return absorbs. */
const PERIODS_IN_YEAR: Record<string, number> = { month: 12, quarter: 4, half: 2, year: 0 }

/**
 * A titled group that is not a label. `Field` renders a `<Label>`, which lends
 * its text to the first control inside it: right for one input, wrong for a
 * tab list or a set of checkboxes, where the first one ended up announcing the
 * whole group's title as its own name.
 */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-stretch gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-3">
      <h3 className="text-[12px] font-semibold tracking-tight text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

interface Column {
  name: string
  label: string
  placeholder?: string
  width?: string
}

/**
 * A table of numbers edited row by row: brackets, elective bounds, fixed
 * dates. An empty "jusqu'à" is the open last row, which is what a bracket
 * table means and what the schemas expect.
 */
function NumberTable({
  columns,
  initial,
  addLabel,
}: {
  columns: Column[]
  initial: Record<string, string>[]
  addLabel: string
}) {
  const t = useTranslations('regime.form')
  const empty = () => Object.fromEntries(columns.map((c) => [c.name, '']))
  const [lines, setLines] = useState<{ key: number; values: Record<string, string> }[]>(() =>
    (initial.length > 0 ? initial : [empty()]).map((values, key) => ({ key, values })),
  )
  const [next, setNext] = useState(lines.length)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 pl-1 text-[10.5px] text-faint">
        {columns.map((column) => (
          <span key={column.name} className={column.width ?? 'flex-1'}>
            {column.label}
          </span>
        ))}
        <span className="size-7 shrink-0" />
      </div>
      <div className="flex flex-col divide-y divide-border/70 border-y border-border">
        {lines.map((line, index) => (
          <div key={line.key} className="flex items-center gap-2 py-1.5">
            {columns.map((column) => (
              <Input
                key={column.name}
                name={column.name}
                inputMode="decimal"
                autoComplete="off"
                placeholder={column.placeholder}
                aria-label={t('cell', { column: column.label, row: index + 1 })}
                value={line.values[column.name] ?? ''}
                onChange={(e) =>
                  setLines(
                    lines.map((l) =>
                      l.key === line.key
                        ? { ...l, values: { ...l.values, [column.name]: e.target.value } }
                        : l,
                    ),
                  )
                }
                className={`h-7 text-right font-mono text-[12.5px] tabular ${column.width ?? 'flex-1'}`}
              />
            ))}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-faint hover:text-destructive"
              aria-label={t('removeRow', { row: index + 1 })}
              onClick={() => setLines(lines.filter((l) => l.key !== line.key))}
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 w-fit gap-1.5 text-[12px]"
        onClick={() => {
          setLines([...lines, { key: next, values: empty() }])
          setNext(next + 1)
        }}
      >
        <PlusIcon className="size-3.5" />
        {addLabel}
      </Button>
    </div>
  )
}

/** What is credited against the base, one line each. */
function CreditTable({
  levies,
  initial,
}: {
  levies: Option[]
  initial: { source: string; levyId?: string; share?: number; periodRef?: string }[]
}) {
  const t = useTranslations('regime.form')
  const words = useLevyWords()
  const [lines, setLines] = useState(() => initial.map((values, key) => ({ key, ...values })))
  const [next, setNext] = useState(lines.length)

  return (
    <div className="flex flex-col gap-1.5">
      {lines.map((line, index) => (
        <div key={line.key} className="flex flex-col gap-1.5 border-t border-border/70 pt-1.5 first:border-0">
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <FormSelect
                name="creditSource"
                defaultValue={line.source}
                placeholder={t('creditSource')}
                options={CREDIT_SOURCES.map((value) => ({ value, label: t(`creditSources.${value}`) }))}
              />
            </div>
            <Input
              name="creditShare"
              inputMode="decimal"
              autoComplete="off"
              defaultValue={line.share === undefined ? '100' : String(line.share)}
              aria-label={t('creditShare', { row: index + 1 })}
              className="h-9 w-16 text-right font-mono text-[12.5px] tabular"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 text-faint hover:text-destructive"
              aria-label={t('removeCredit', { row: index + 1 })}
              onClick={() => setLines(lines.filter((l) => l.key !== line.key))}
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-2 pr-9">
            <div className="flex-1">
              <FormSelect
                name="creditLevyId"
                defaultValue={line.levyId ?? ''}
                noneLabel={t('noRule')}
                options={levies.map((l) => ({ value: l.id, label: l.name }))}
              />
            </div>
            <div className="flex-1">
              <FormSelect
                name="creditPeriodRef"
                defaultValue={line.periodRef ?? 'current'}
                options={periodRefOptions(words)}
              />
            </div>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 w-fit gap-1.5 text-[12px]"
        onClick={() => {
          setLines([...lines, { key: next, source: 'withholdings', share: 100, periodRef: 'current' }])
          setNext(next + 1)
        }}
      >
        <PlusIcon className="size-3.5" />
        {t('addCredit')}
      </Button>
    </div>
  )
}

/** The reference periods a measure is read over, in the order the list offers them. */
function periodRefOptions(words: LevyWords) {
  return LEVY_PERIOD_REFS.map((value) => ({ value, label: words.periodRef(value) }))
}

/** A JSON parameter of the row, read back into the fields that wrote it. */
function doc<T>(value: unknown): T | undefined {
  return (value ?? undefined) as T | undefined
}

export function LevyForm({
  activityId,
  categories,
  levies,
  today,
  draft,
  mode = 'create',
  onDone,
}: {
  activityId: string
  categories: Option[]
  /** The other rules of the activity: what a base, an add-back or a credit reads. */
  levies: Option[]
  today: string
  draft?: LevyDraft
  mode?: 'create' | 'edit' | 'supersede'
  onDone?: () => void
}) {
  const t = useTranslations('regime.form')
  const ts = useTranslations('regime.shared')
  const tm = useTranslations('regime.measureOptions')
  const words = useLevyWords()
  const format = useFormat()
  const [measure, setMeasure] = useState(draft?.baseMeasure ?? 'revenue')
  const [form, setForm] = useState(draft?.amountForm ?? 'rate')
  const abatement = doc<{
    rate?: number
    minAmount?: number
    brackets?: { upTo: number | null; rate: number }[]
    on?: { measure: string; periodRef: string }
  }>(draft?.baseAbatement)
  const [abatementMode, setAbatementMode] = useState(
    abatement === undefined ? 'none' : abatement.brackets ? 'brackets' : 'rate',
  )
  const due = doc<{
    type: string
    monthOffset?: number
    fromDay?: number
    toDay?: number
    dates?: { month: number; day: number; yearOffset: number }[]
  }>(draft?.due)
  const [dueType, setDueType] = useState(due?.type ?? 'end_of_next_month')
  const [period, setPeriod] = useState(draft?.period ?? 'month')
  const [regularization, setRegularization] = useState(draft?.regularization ?? 'none')

  const brackets = doc<{ mode: string; rows: { upTo: number | null; rate?: number; amount?: number }[] }>(
    draft?.brackets,
  )
  const elective = doc<{
    rows: { upTo: number | null; minBase: number; maxBase: number }[]
    inputName: string
    rate: number
  }>(draft?.elective)
  const credits =
    doc<{ source: string; levyId?: string; share?: number; periodRef?: string }[]>(draft?.baseCredits) ?? []
  const skip = doc<Record<string, number[]>>(draft?.skipPeriods) ?? {}
  const skipped = new Set(skip[period] ?? [])
  const regParams = doc<{ settleMonthOffset?: number; refundMonthOffset?: number }>(
    draft?.regularizationParams,
  )

  const cell = (value: number | null | undefined) =>
    value === null || value === undefined ? '' : String(value)
  const superseding = mode === 'supersede'
  const periodRefs = periodRefOptions(words)
  const measureOptions = MEASURES.map((value) => ({ value, label: tm(value) }))

  return (
    <ActionForm
      action={superseding ? supersedeLevyAction : mode === 'edit' ? editLevyAction : createLevyAction}
      onSuccess={onDone}
      successLabel={
        superseding ? t('success.superseded') : mode === 'edit' ? t('success.edited') : t('success.created')
      }
    >
      <input type="hidden" name="activityId" value={activityId} />
      {draft && <input type="hidden" name="levyId" value={draft.id} />}

      <div className="flex flex-col gap-3">
        <TextField
          name="name"
          label={ts('name')}
          defaultValue={draft?.name ?? ''}
          placeholder={t('namePlaceholder')}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('kind')} name="kind">
            <FormSelect
              name="kind"
              required
              defaultValue={draft?.kind ?? 'social'}
              options={KINDS.map((value) => ({ value, label: words.kind(value) }))}
            />
          </Field>
          <Field label={ts('status')}>
            <FormSelect
              name="status"
              defaultValue={draft?.status ?? 'confirmed'}
              options={STATUSES.map((value) => ({ value, label: t(`statuses.${value}`) }))}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={superseding ? t('newValuesFrom') : t('validFrom')} name="validFrom">
            <DateField
              name="validFrom"
              defaultValue={superseding ? undefined : (draft?.validFrom ?? today)}
            />
          </Field>
          <Field label={t('validTo')} name="validTo">
            <DateField
              name="validTo"
              defaultValue={superseding ? undefined : (draft?.validTo ?? undefined)}
            />
          </Field>
        </div>
        {superseding && draft && (
          <p className="text-[11.5px] text-faint">
            {t('supersedeNote', { date: format.date(draft.validFrom) })}
          </p>
        )}
        <TextField
          name="sourceUrl"
          label={t('sourceUrl')}
          defaultValue={draft?.sourceUrl ?? ''}
          placeholder="https://…"
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label={ts('verifiedOn')} name="verifiedOn">
            <DateField name="verifiedOn" defaultValue={superseding ? today : (draft?.verifiedOn ?? today)} />
          </Field>
          <Field label={ts('reviewOn')} name="reviewOn">
            <DateField
              name="reviewOn"
              defaultValue={superseding ? undefined : (draft?.reviewOn ?? undefined)}
            />
          </Field>
        </div>
      </div>

      <Block title={t('blocks.base')}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={ts('measure')} name="baseMeasure">
            <FormSelect
              name="baseMeasure"
              required
              defaultValue={measure}
              options={measureOptions}
              onValueChange={setMeasure}
            />
          </Field>
          <Field label={ts('readOn')}>
            <FormSelect
              name="basePeriodRef"
              defaultValue={draft?.basePeriodRef ?? 'current'}
              options={periodRefs}
            />
          </Field>
        </div>
        {(measure === 'paid' || measure === 'amount') && (
          <Field label={t('baseLevy')} name="baseLevyId">
            <FormSelect
              name="baseLevyId"
              required
              placeholder={t('pickRule')}
              defaultValue={draft?.baseLevyId ?? ''}
              options={levies.map((l) => ({ value: l.id, label: l.name }))}
            />
          </Field>
        )}
        {measure === 'input' && (
          <TextField
            name="baseInputName"
            label={t('baseInputName')}
            defaultValue={draft?.baseInputName ?? ''}
            placeholder="contribution_base"
          />
        )}
        {measure !== 'none' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('coefficient')} name="baseCoefficient">
                <Input
                  name="baseCoefficient"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={t('coefficientPlaceholder')}
                  defaultValue={draft?.baseCoefficient ?? ''}
                  className="text-right font-mono tabular"
                />
              </Field>
              <Field label={t('scale')}>
                <FormSelect
                  name="baseScale"
                  defaultValue={draft?.baseScale ?? 'none'}
                  options={SCALES.map((value) => ({ value, label: t(`scales.${value}`) }))}
                />
              </Field>
            </div>

            {levies.length > 0 && (
              <Group label={t('addBack')}>
                <div className="flex flex-col gap-1.5 pt-1">
                  {levies.map((levy) => (
                    <Label
                      key={levy.id}
                      className="flex items-center gap-2 text-[12.5px] font-normal text-foreground"
                    >
                      <Checkbox
                        name="addBackLevyId"
                        value={levy.id}
                        defaultChecked={draft?.baseAddBackLevyIds?.includes(levy.id)}
                      />
                      {levy.name}
                    </Label>
                  ))}
                </div>
              </Group>
            )}

            <Group label={t('abatement')}>
              <Tabs value={abatementMode} onValueChange={setAbatementMode}>
                <TabsList className="w-full">
                  <TabsTrigger value="none">{t('abatementModes.none')}</TabsTrigger>
                  <TabsTrigger value="rate">{t('abatementModes.rate')}</TabsTrigger>
                  <TabsTrigger value="brackets">{t('abatementModes.brackets')}</TabsTrigger>
                </TabsList>
              </Tabs>
            </Group>
            <input type="hidden" name="abatementMode" value={abatementMode} />
            {abatementMode === 'rate' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('rate')} name="abatementRate">
                  <Input
                    name="abatementRate"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="34"
                    defaultValue={cell(abatement?.rate)}
                    className="text-right font-mono tabular"
                  />
                </Field>
                <Field label={t('minimum')} name="abatementMinAmount">
                  <AmountInput name="abatementMinAmount" defaultValue={cell(abatement?.minAmount)} />
                </Field>
              </div>
            )}
            {abatementMode === 'brackets' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('tierReadOn')} name="abatementMeasure">
                    <FormSelect
                      name="abatementMeasure"
                      defaultValue={abatement?.on?.measure ?? 'profit'}
                      options={measureOptions.filter(
                        (m) => !['paid', 'amount', 'input', 'none'].includes(m.value),
                      )}
                    />
                  </Field>
                  <Field label={t('ofPeriod')}>
                    <FormSelect
                      name="abatementPeriodRef"
                      defaultValue={abatement?.on?.periodRef ?? 'year-1'}
                      options={periodRefs}
                    />
                  </Field>
                </div>
                <NumberTable
                  columns={[
                    { name: 'abatementUpTo', label: t('upTo'), placeholder: t('open') },
                    { name: 'abatementBracketRate', label: t('ratePercent'), width: 'w-20' },
                  ]}
                  initial={(abatement?.brackets ?? []).map((row) => ({
                    abatementUpTo: cell(row.upTo),
                    abatementBracketRate: cell(row.rate),
                  }))}
                  addLabel={t('addTier')}
                />
              </>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label={t('floor')} name="baseFloor">
                <AmountInput name="baseFloor" defaultValue={draft?.baseFloor ?? ''} />
              </Field>
              <Field label={t('cap')} name="baseCap">
                <AmountInput name="baseCap" defaultValue={draft?.baseCap ?? ''} />
              </Field>
            </div>

            <Group label={t('credits')}>
              <CreditTable levies={levies} initial={credits} />
            </Group>
          </>
        )}
      </Block>

      <Block title={t('blocks.amount')}>
        <Tabs value={form} onValueChange={setForm}>
          <TabsList className="w-full">
            <TabsTrigger value="rate">{t('amountForms.rate')}</TabsTrigger>
            <TabsTrigger value="brackets">{t('amountForms.brackets')}</TabsTrigger>
            <TabsTrigger value="elective_base">{t('amountForms.elective_base')}</TabsTrigger>
            <TabsTrigger value="fixed">{t('amountForms.fixed')}</TabsTrigger>
            <TabsTrigger value="none">{t('amountForms.none')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <input type="hidden" name="amountForm" value={form} />

        {form === 'rate' && (
          <Field label={t('rate')} name="rate">
            <Input
              name="rate"
              inputMode="decimal"
              autoComplete="off"
              placeholder={t('ratePlaceholder')}
              defaultValue={draft?.rate ?? ''}
              className="text-right font-mono tabular"
            />
          </Field>
        )}

        {form === 'brackets' && (
          <>
            <Field label={t('bracketsMode')}>
              <FormSelect
                name="bracketsMode"
                defaultValue={brackets?.mode ?? 'progressive'}
                options={[
                  { value: 'progressive', label: t('bracketsModes.progressive') },
                  { value: 'step', label: t('bracketsModes.step') },
                ]}
              />
            </Field>
            <NumberTable
              columns={[
                { name: 'bracketUpTo', label: t('upTo'), placeholder: t('open') },
                { name: 'bracketRate', label: t('ratePercent'), width: 'w-20' },
                { name: 'bracketAmount', label: t('orEuro'), width: 'w-24' },
              ]}
              initial={(brackets?.rows ?? []).map((row) => ({
                bracketUpTo: cell(row.upTo),
                bracketRate: cell(row.rate),
                bracketAmount: cell(row.amount),
              }))}
              addLabel={t('addBracket')}
            />
          </>
        )}

        {form === 'elective_base' && (
          <>
            <NumberTable
              columns={[
                { name: 'electiveUpTo', label: t('upTo'), placeholder: t('open') },
                { name: 'electiveMinBase', label: t('minBase') },
                { name: 'electiveMaxBase', label: t('maxBase') },
              ]}
              initial={(elective?.rows ?? []).map((row) => ({
                electiveUpTo: cell(row.upTo),
                electiveMinBase: cell(row.minBase),
                electiveMaxBase: cell(row.maxBase),
              }))}
              addLabel={t('addTramo')}
            />
            <div className="grid grid-cols-2 gap-3">
              <TextField
                name="electiveInputName"
                label={t('electiveInput')}
                defaultValue={elective?.inputName ?? ''}
                placeholder="contribution_base"
              />
              <Field label={t('rate')} name="electiveRate">
                <Input
                  name="electiveRate"
                  inputMode="decimal"
                  autoComplete="off"
                  defaultValue={cell(elective?.rate)}
                  className="text-right font-mono tabular"
                />
              </Field>
            </div>
          </>
        )}

        {form === 'fixed' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('fixedAmount')} name="fixedAmount">
              <AmountInput name="fixedAmount" defaultValue={draft?.fixedAmount ?? ''} />
            </Field>
            <TextField
              name="fixedInputName"
              label={t('orInput')}
              defaultValue={draft?.fixedInputName ?? ''}
              placeholder="local_tax_notice"
            />
          </div>
        )}

        {form !== 'none' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('fixedCredit')} name="fixedCredit">
              <AmountInput name="fixedCredit" defaultValue={draft?.fixedCredit ?? ''} />
            </Field>
            <TextField
              name="creditInputName"
              label={t('creditInput')}
              defaultValue={draft?.creditInputName ?? ''}
              placeholder="personal_credits"
            />
          </div>
        )}
      </Block>

      <Block title={t('blocks.schedule')}>
        <Field label={t('period')} name="period">
          <FormSelect
            name="period"
            required
            defaultValue={period}
            options={PERIODS.map((value) => ({ value, label: words.period(value) }))}
            onValueChange={setPeriod}
          />
        </Field>
        <Group label={t('due')}>
          <Tabs value={dueType} onValueChange={setDueType}>
            <TabsList className="w-full">
              <TabsTrigger value="end_of_next_month">{t('dueTypes.end_of_next_month')}</TabsTrigger>
              <TabsTrigger value="after_period">{t('dueTypes.after_period')}</TabsTrigger>
              <TabsTrigger value="fixed_dates">{t('dueTypes.fixed_dates')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </Group>
        <input type="hidden" name="dueType" value={dueType} />
        {dueType === 'after_period' && (
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('monthsAfter')} name="dueMonthOffset">
              <Input
                name="dueMonthOffset"
                inputMode="numeric"
                autoComplete="off"
                placeholder="1"
                defaultValue={cell(due?.monthOffset)}
                className="text-right font-mono tabular"
              />
            </Field>
            <Field label={t('fromDay')} name="dueFromDay">
              <Input
                name="dueFromDay"
                inputMode="numeric"
                autoComplete="off"
                placeholder="1"
                defaultValue={cell(due?.fromDay)}
                className="text-right font-mono tabular"
              />
            </Field>
            <Field label={t('toDay')} name="dueToDay">
              <Input
                name="dueToDay"
                inputMode="numeric"
                autoComplete="off"
                placeholder="25"
                defaultValue={cell(due?.toDay)}
                className="text-right font-mono tabular"
              />
            </Field>
          </div>
        )}
        {dueType === 'fixed_dates' && (
          <NumberTable
            columns={[
              { name: 'dueDateMonth', label: t('month') },
              { name: 'dueDateDay', label: t('day') },
              { name: 'dueDateYearOffset', label: t('yearOffset') },
            ]}
            initial={(due?.dates ?? []).map((date) => ({
              dueDateMonth: cell(date.month),
              dueDateDay: cell(date.day),
              dueDateYearOffset: cell(date.yearOffset),
            }))}
            addLabel={t('addDate')}
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('lag')} name="declarationLagMonths">
            <Input
              name="declarationLagMonths"
              inputMode="numeric"
              autoComplete="off"
              defaultValue={cell(draft?.declarationLagMonths)}
              className="text-right font-mono tabular"
            />
          </Field>
          <Field label={t('firstDue')} name="firstDueAfterDays">
            <Input
              name="firstDueAfterDays"
              inputMode="numeric"
              autoComplete="off"
              defaultValue={cell(draft?.firstDueAfterDays)}
              className="text-right font-mono tabular"
            />
          </Field>
        </div>
        {PERIODS_IN_YEAR[period]! > 0 && (
          <Group label={t('skipped')}>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
              {Array.from({ length: PERIODS_IN_YEAR[period]! }, (_, i) => i + 1).map((index) => (
                <Label
                  key={index}
                  className="flex items-center gap-2 text-[12.5px] font-normal text-foreground"
                >
                  <Checkbox name="skipPeriod" value={String(index)} defaultChecked={skipped.has(index)} />
                  {index}
                </Label>
              ))}
            </div>
          </Group>
        )}
      </Block>

      <Block title={t('blocks.regularization')}>
        <Field label={t('regularizationMode')}>
          <FormSelect
            name="regularization"
            defaultValue={regularization}
            options={REGULARIZATIONS.map((value) => ({ value, label: t(`regularizations.${value}`) }))}
            onValueChange={setRegularization}
          />
        </Field>
        {regularization !== 'none' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('settleOffset')} name="settleMonthOffset">
              <Input
                name="settleMonthOffset"
                inputMode="numeric"
                autoComplete="off"
                defaultValue={cell(regParams?.settleMonthOffset)}
                className="text-right font-mono tabular"
              />
            </Field>
            <Field label={t('refundOffset')} name="refundMonthOffset">
              <Input
                name="refundMonthOffset"
                inputMode="numeric"
                autoComplete="off"
                defaultValue={cell(regParams?.refundMonthOffset)}
                className="text-right font-mono tabular"
              />
            </Field>
          </div>
        )}
      </Block>

      <Block title={t('blocks.settlement')}>
        <Field label={t('settlementCategory')}>
          <FormSelect
            name="settlementCategoryId"
            noneLabel={t('noCategory')}
            defaultValue={draft?.settlementCategoryId ?? ''}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
        <Label className="flex items-start gap-2 text-[12.5px] font-normal text-foreground">
          <Checkbox name="deductible" defaultChecked={draft?.deductible} className="mt-px" />
          <span>
            {t('deductible')}
            <span className="block text-[11px] text-faint">{t('deductibleHint')}</span>
          </span>
        </Label>
        <Label className="flex items-start gap-2 text-[12.5px] font-normal text-foreground">
          <Checkbox name="passThrough" defaultChecked={draft?.passThrough} className="mt-px" />
          <span>
            {t('passThrough')}
            <span className="block text-[11px] text-faint">{t('passThroughHint')}</span>
          </span>
        </Label>
        <TextField name="note" label={t('note')} defaultValue={draft?.note ?? ''} />
      </Block>

      <SubmitButton className="self-start">
        {superseding ? t('supersede') : mode === 'edit' ? ts('save') : t('create')}
      </SubmitButton>
    </ActionForm>
  )
}
