'use client'

import { PlusIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { createLevyAction, editLevyAction, supersedeLevyAction } from '@/lib/actions'
import { frDate } from '@/lib/utils'

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

const KINDS = [
  { value: 'social', label: 'Cotisations sociales' },
  { value: 'income_tax', label: 'Impôt sur le revenu' },
  { value: 'vat', label: 'TVA' },
  { value: 'other', label: 'Autre' },
]

const STATUSES = [
  { value: 'confirmed', label: 'Confirmée par un texte' },
  { value: 'extended_by_default', label: 'Prorogée faute de texte' },
  { value: 'unconfirmed', label: 'Non confirmée' },
]

const MEASURES = [
  { value: 'revenue', label: 'Recettes HT' },
  { value: 'revenue_incl_vat', label: 'Recettes TTC' },
  { value: 'expenses', label: 'Dépenses déductibles' },
  { value: 'profit', label: 'Bénéfice' },
  { value: 'vat_balance', label: 'TVA collectée − déductible' },
  { value: 'withholdings', label: 'Retenues à la source' },
  { value: 'paid', label: 'Règlements d’une autre règle' },
  { value: 'amount', label: 'Montant d’une autre règle' },
  { value: 'input', label: 'Paramètre saisi' },
  { value: 'none', label: 'Aucune base' },
]

const PERIOD_REFS = [
  { value: 'current', label: 'la période' },
  { value: 'ytd', label: 'l’exercice en cours' },
  { value: 'year-1', label: 'l’exercice n−1' },
  { value: 'year-2', label: 'l’exercice n−2' },
  { value: 'rolling-12', label: '12 mois glissants' },
]

const SCALES = [
  { value: 'none', label: 'telle quelle' },
  { value: 'per_month', label: 'ramenée au mois' },
  { value: 'annualized', label: 'annualisée' },
]

const PERIODS = [
  { value: 'month', label: 'mensuelle' },
  { value: 'quarter', label: 'trimestrielle' },
  { value: 'half', label: 'semestrielle' },
  { value: 'year', label: 'annuelle' },
]

const REGULARIZATIONS = [
  { value: 'none', label: 'Aucune : chaque période est définitive' },
  { value: 'annual_deadzone', label: 'Zone morte à la clôture' },
  { value: 'provisional_then_settled', label: 'Provisoire, puis définitive' },
]

const CREDIT_SOURCES = [
  { value: 'withholdings', label: 'Retenues à la source' },
  { value: 'paid', label: 'Règlements d’une règle' },
  { value: 'amount', label: 'Montant d’une règle' },
]

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
                aria-label={`${column.label}, ligne ${index + 1}`}
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
              aria-label={`Retirer la ligne ${index + 1}`}
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
                placeholder="Ce qui est crédité"
                options={CREDIT_SOURCES}
              />
            </div>
            <Input
              name="creditShare"
              inputMode="decimal"
              autoComplete="off"
              defaultValue={line.share === undefined ? '100' : String(line.share)}
              aria-label={`Part créditée, ligne ${index + 1}`}
              className="h-9 w-16 text-right font-mono text-[12.5px] tabular"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 text-faint hover:text-destructive"
              aria-label={`Retirer le crédit ${index + 1}`}
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
                noneLabel="(aucune règle)"
                options={levies.map((l) => ({ value: l.id, label: l.name }))}
              />
            </div>
            <div className="flex-1">
              <FormSelect
                name="creditPeriodRef"
                defaultValue={line.periodRef ?? 'current'}
                options={PERIOD_REFS}
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
        Ajouter un crédit
      </Button>
    </div>
  )
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

  return (
    <ActionForm
      action={superseding ? supersedeLevyAction : mode === 'edit' ? editLevyAction : createLevyAction}
      onSuccess={onDone}
      successLabel={superseding ? 'Règle remplacée' : mode === 'edit' ? 'Règle corrigée' : 'Règle créée'}
    >
      <input type="hidden" name="activityId" value={activityId} />
      {draft && <input type="hidden" name="levyId" value={draft.id} />}

      <div className="flex flex-col gap-3">
        <TextField name="name" label="Nom" defaultValue={draft?.name ?? ''} placeholder="Cotisations" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nature" name="kind">
            <FormSelect name="kind" required defaultValue={draft?.kind ?? 'social'} options={KINDS} />
          </Field>
          <Field label="Statut">
            <FormSelect name="status" defaultValue={draft?.status ?? 'confirmed'} options={STATUSES} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={superseding ? 'Nouvelles valeurs à partir du' : 'En vigueur à partir du'}
            name="validFrom"
          >
            <DateField
              name="validFrom"
              defaultValue={superseding ? undefined : (draft?.validFrom ?? today)}
            />
          </Field>
          <Field label="Jusqu’au (optionnel)" name="validTo">
            <DateField
              name="validTo"
              defaultValue={superseding ? undefined : (draft?.validTo ?? undefined)}
            />
          </Field>
        </div>
        {superseding && draft && (
          <p className="text-[11.5px] text-faint">
            La règle en vigueur depuis le {frDate(draft.validFrom)} se clôt la veille de cette date. Le relevé
            des exercices déjà passés garde ses chiffres.
          </p>
        )}
        <TextField
          name="sourceUrl"
          label="Source (URL du texte)"
          defaultValue={draft?.sourceUrl ?? ''}
          placeholder="https://…"
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vérifiée le" name="verifiedOn">
            <DateField name="verifiedOn" defaultValue={superseding ? today : (draft?.verifiedOn ?? today)} />
          </Field>
          <Field label="À revérifier le" name="reviewOn">
            <DateField
              name="reviewOn"
              defaultValue={superseding ? undefined : (draft?.reviewOn ?? undefined)}
            />
          </Field>
        </div>
      </div>

      <Block title="Base">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mesure" name="baseMeasure">
            <FormSelect
              name="baseMeasure"
              required
              defaultValue={measure}
              options={MEASURES}
              onValueChange={setMeasure}
            />
          </Field>
          <Field label="Lue sur">
            <FormSelect
              name="basePeriodRef"
              defaultValue={draft?.basePeriodRef ?? 'current'}
              options={PERIOD_REFS}
            />
          </Field>
        </div>
        {(measure === 'paid' || measure === 'amount') && (
          <Field label="Règle lue" name="baseLevyId">
            <FormSelect
              name="baseLevyId"
              required
              placeholder="Choisir la règle"
              defaultValue={draft?.baseLevyId ?? ''}
              options={levies.map((l) => ({ value: l.id, label: l.name }))}
            />
          </Field>
        )}
        {measure === 'input' && (
          <TextField
            name="baseInputName"
            label="Nom du paramètre saisi"
            defaultValue={draft?.baseInputName ?? ''}
            placeholder="contribution_base"
          />
        )}
        {measure !== 'none' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Coefficient (optionnel)" name="baseCoefficient">
                <Input
                  name="baseCoefficient"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0,93"
                  defaultValue={draft?.baseCoefficient ?? ''}
                  className="text-right font-mono tabular"
                />
              </Field>
              <Field label="Lecture de la mesure">
                <FormSelect name="baseScale" defaultValue={draft?.baseScale ?? 'none'} options={SCALES} />
              </Field>
            </div>

            {levies.length > 0 && (
              <Group label="Réintégrer les règlements de">
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

            <Group label="Abattement">
              <Tabs value={abatementMode} onValueChange={setAbatementMode}>
                <TabsList className="w-full">
                  <TabsTrigger value="none">Aucun</TabsTrigger>
                  <TabsTrigger value="rate">Taux fixe</TabsTrigger>
                  <TabsTrigger value="brackets">Par palier</TabsTrigger>
                </TabsList>
              </Tabs>
            </Group>
            <input type="hidden" name="abatementMode" value={abatementMode} />
            {abatementMode === 'rate' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Taux (%)" name="abatementRate">
                  <Input
                    name="abatementRate"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="34"
                    defaultValue={cell(abatement?.rate)}
                    className="text-right font-mono tabular"
                  />
                </Field>
                <Field label="Minimum (€)" name="abatementMinAmount">
                  <AmountInput name="abatementMinAmount" defaultValue={cell(abatement?.minAmount)} />
                </Field>
              </div>
            )}
            {abatementMode === 'brackets' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Palier lu sur" name="abatementMeasure">
                    <FormSelect
                      name="abatementMeasure"
                      defaultValue={abatement?.on?.measure ?? 'profit'}
                      options={MEASURES.filter((m) => !['paid', 'amount', 'input', 'none'].includes(m.value))}
                    />
                  </Field>
                  <Field label="De la période">
                    <FormSelect
                      name="abatementPeriodRef"
                      defaultValue={abatement?.on?.periodRef ?? 'year-1'}
                      options={PERIOD_REFS}
                    />
                  </Field>
                </div>
                <NumberTable
                  columns={[
                    { name: 'abatementUpTo', label: 'Jusqu’à', placeholder: 'ouvert' },
                    { name: 'abatementBracketRate', label: 'Taux %', width: 'w-20' },
                  ]}
                  initial={(abatement?.brackets ?? []).map((row) => ({
                    abatementUpTo: cell(row.upTo),
                    abatementBracketRate: cell(row.rate),
                  }))}
                  addLabel="Ajouter un palier"
                />
              </>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Plancher (€)" name="baseFloor">
                <AmountInput name="baseFloor" defaultValue={draft?.baseFloor ?? ''} />
              </Field>
              <Field label="Plafond (€)" name="baseCap">
                <AmountInput name="baseCap" defaultValue={draft?.baseCap ?? ''} />
              </Field>
            </div>

            <Group label="Crédits sur la base">
              <CreditTable levies={levies} initial={credits} />
            </Group>
          </>
        )}
      </Block>

      <Block title="Montant">
        <Tabs value={form} onValueChange={setForm}>
          <TabsList className="w-full">
            <TabsTrigger value="rate">Taux</TabsTrigger>
            <TabsTrigger value="brackets">Barème</TabsTrigger>
            <TabsTrigger value="elective_base">Base choisie</TabsTrigger>
            <TabsTrigger value="fixed">Fixe</TabsTrigger>
            <TabsTrigger value="none">Rien</TabsTrigger>
          </TabsList>
        </Tabs>
        <input type="hidden" name="amountForm" value={form} />

        {form === 'rate' && (
          <Field label="Taux (%)" name="rate">
            <Input
              name="rate"
              inputMode="decimal"
              autoComplete="off"
              placeholder="21,2"
              defaultValue={draft?.rate ?? ''}
              className="text-right font-mono tabular"
            />
          </Field>
        )}

        {form === 'brackets' && (
          <>
            <Field label="Lecture du barème">
              <FormSelect
                name="bracketsMode"
                defaultValue={brackets?.mode ?? 'progressive'}
                options={[
                  { value: 'progressive', label: 'Progressif : chaque tranche à son taux' },
                  { value: 'step', label: 'Par palier : la tranche atteinte s’applique en entier' },
                ]}
              />
            </Field>
            <NumberTable
              columns={[
                { name: 'bracketUpTo', label: 'Jusqu’à', placeholder: 'ouvert' },
                { name: 'bracketRate', label: 'Taux %', width: 'w-20' },
                { name: 'bracketAmount', label: 'ou € ', width: 'w-24' },
              ]}
              initial={(brackets?.rows ?? []).map((row) => ({
                bracketUpTo: cell(row.upTo),
                bracketRate: cell(row.rate),
                bracketAmount: cell(row.amount),
              }))}
              addLabel="Ajouter une tranche"
            />
          </>
        )}

        {form === 'elective_base' && (
          <>
            <NumberTable
              columns={[
                { name: 'electiveUpTo', label: 'Jusqu’à', placeholder: 'ouvert' },
                { name: 'electiveMinBase', label: 'Base mini' },
                { name: 'electiveMaxBase', label: 'Base maxi' },
              ]}
              initial={(elective?.rows ?? []).map((row) => ({
                electiveUpTo: cell(row.upTo),
                electiveMinBase: cell(row.minBase),
                electiveMaxBase: cell(row.maxBase),
              }))}
              addLabel="Ajouter un tramo"
            />
            <div className="grid grid-cols-2 gap-3">
              <TextField
                name="electiveInputName"
                label="Paramètre de la base choisie"
                defaultValue={elective?.inputName ?? ''}
                placeholder="contribution_base"
              />
              <Field label="Taux (%)" name="electiveRate">
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
            <Field label="Montant par période (€)" name="fixedAmount">
              <AmountInput name="fixedAmount" defaultValue={draft?.fixedAmount ?? ''} />
            </Field>
            <TextField
              name="fixedInputName"
              label="ou paramètre saisi"
              defaultValue={draft?.fixedInputName ?? ''}
              placeholder="local_tax_notice"
            />
          </div>
        )}

        {form !== 'none' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Crédit fixe (€)" name="fixedCredit">
              <AmountInput name="fixedCredit" defaultValue={draft?.fixedCredit ?? ''} />
            </Field>
            <TextField
              name="creditInputName"
              label="Paramètre de crédits"
              defaultValue={draft?.creditInputName ?? ''}
              placeholder="personal_credits"
            />
          </div>
        )}
      </Block>

      <Block title="Calendrier">
        <Field label="Périodicité" name="period">
          <FormSelect
            name="period"
            required
            defaultValue={period}
            options={PERIODS}
            onValueChange={setPeriod}
          />
        </Field>
        <Group label="Échéance">
          <Tabs value={dueType} onValueChange={setDueType}>
            <TabsList className="w-full">
              <TabsTrigger value="end_of_next_month">Fin du mois suivant</TabsTrigger>
              <TabsTrigger value="after_period">Fenêtre</TabsTrigger>
              <TabsTrigger value="fixed_dates">Dates fixes</TabsTrigger>
            </TabsList>
          </Tabs>
        </Group>
        <input type="hidden" name="dueType" value={dueType} />
        {dueType === 'after_period' && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Mois après" name="dueMonthOffset">
              <Input
                name="dueMonthOffset"
                inputMode="numeric"
                autoComplete="off"
                placeholder="1"
                defaultValue={cell(due?.monthOffset)}
                className="text-right font-mono tabular"
              />
            </Field>
            <Field label="Du jour" name="dueFromDay">
              <Input
                name="dueFromDay"
                inputMode="numeric"
                autoComplete="off"
                placeholder="1"
                defaultValue={cell(due?.fromDay)}
                className="text-right font-mono tabular"
              />
            </Field>
            <Field label="Au jour" name="dueToDay">
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
              { name: 'dueDateMonth', label: 'Mois' },
              { name: 'dueDateDay', label: 'Jour' },
              { name: 'dueDateYearOffset', label: 'Exercice +' },
            ]}
            initial={(due?.dates ?? []).map((date) => ({
              dueDateMonth: cell(date.month),
              dueDateDay: cell(date.day),
              dueDateYearOffset: cell(date.yearOffset),
            }))}
            addLabel="Ajouter une date"
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Paiement décalé de (mois)" name="declarationLagMonths">
            <Input
              name="declarationLagMonths"
              inputMode="numeric"
              autoComplete="off"
              defaultValue={cell(draft?.declarationLagMonths)}
              className="text-right font-mono tabular"
            />
          </Field>
          <Field label="Première échéance après (jours)" name="firstDueAfterDays">
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
          <Group label="Périodes absorbées par une autre déclaration">
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

      <Block title="Régularisation">
        <Field label="Mode">
          <FormSelect
            name="regularization"
            defaultValue={regularization}
            options={REGULARIZATIONS}
            onValueChange={setRegularization}
          />
        </Field>
        {regularization !== 'none' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Régularisée (mois après l’exercice)" name="settleMonthOffset">
              <Input
                name="settleMonthOffset"
                inputMode="numeric"
                autoComplete="off"
                defaultValue={cell(regParams?.settleMonthOffset)}
                className="text-right font-mono tabular"
              />
            </Field>
            <Field label="Remboursée (mois après)" name="refundMonthOffset">
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

      <Block title="Règlement">
        <Field label="Catégorie qui la règle">
          <FormSelect
            name="settlementCategoryId"
            noneLabel="(aucune)"
            defaultValue={draft?.settlementCategoryId ?? ''}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
        <Label className="flex items-start gap-2 text-[12.5px] font-normal text-foreground">
          <Checkbox name="deductible" defaultChecked={draft?.deductible} className="mt-px" />
          <span>
            La payer réduit le bénéfice
            <span className="block text-[11px] text-faint">
              une cotisation sociale souvent, un impôt sur le revenu jamais
            </span>
          </span>
        </Label>
        <Label className="flex items-start gap-2 text-[12.5px] font-normal text-foreground">
          <Checkbox name="passThrough" defaultChecked={draft?.passThrough} className="mt-px" />
          <span>
            Collectée pour le compte de l’État
            <span className="block text-[11px] text-faint">
              la TVA n’est ni une recette ni une charge, elle sort du net
            </span>
          </span>
        </Label>
        <TextField name="note" label="Note (optionnelle)" defaultValue={draft?.note ?? ''} />
      </Block>

      <SubmitButton className="self-start">
        {superseding ? 'Remplacer la règle' : mode === 'edit' ? 'Enregistrer' : 'Créer la règle'}
      </SubmitButton>
    </ActionForm>
  )
}
