import type * as z from 'zod'
import { db, type Executor } from '../db/client.ts'
import { getActivity, getCategory } from '../db/datasources/catalog.ts'
import {
  countLevyReferences,
  countSettlements,
  deleteInputRow,
  deleteLevyRow,
  deleteModifierRow,
  deleteThresholdRow,
  getInput,
  getLevy,
  getModifier,
  getThreshold,
  inputAt,
  insertLevy,
  insertModifier,
  insertThreshold,
  listInputs as listInputsDs,
  listLevies as listLeviesDs,
  listModifiers,
  listThresholds as listThresholdsDs,
  updateLevyRow,
  updateModifierRow,
  updateThresholdRow,
  upsertInput,
} from '../db/datasources/levies.ts'
import { DomainError } from '../domain/errors.ts'
import {
  abatementSchema,
  bracketsSchema,
  creditsSchema,
  dueSchema,
  electiveSchema,
  regularizationParamsSchema,
  skipPeriodsSchema,
} from '../domain/levy.ts'
import type {
  Activity,
  ActivityInput,
  AmountForm,
  BaseScale,
  Levy,
  LevyKind,
  LevyMeasure,
  LevyModifier,
  LevyPeriod,
  LevyStatus,
  ModifierEffect,
  PeriodRef,
  Regularization,
  Threshold,
  ThresholdMeasure,
} from '../domain/types.ts'

/**
 * The rules of an activity, in data: what it owes, on which base, in which
 * form, when, and how it is settled. No rate, no country, no regime lives in
 * this file; it only knows the grammar of migration 0018 and refuses what
 * would not compute.
 *
 * A rule is worth its source. Every row carries the URL of the text that fixes
 * its value, the day someone checked it, the day it should be checked again
 * (a yearly schedule ages every 1 January) and a status: `confirmed`,
 * `extended_by_default` when a lapsed text is still applied by the
 * administration, `unconfirmed` when no text fixes the value at all. The
 * screens show the status beside every figure the rule produces, and the MCP
 * tool asks for the source and the check date on every creation, because an
 * AI citing a rate from memory is the one way a wrong rule gets in unnoticed.
 * The columns stay nullable here: a person may type a rule from a paper notice.
 *
 * What the gestures guarantee:
 * - `createLevy` writes a rule for a `business` activity of the user only,
 *   with its JSON parameters validated by domain/levy.ts (the engine trusts
 *   what it reads because nothing else ever wrote it), the parameters its
 *   amount form and base measure need present and the others absent, and every
 *   rule it references (base, add-back, credits) belonging to the same
 *   activity: a rule reading another activity's settlements would mix two
 *   regimes.
 * - `editLevy` corrects a rule that was mistyped. It rewrites the row in place
 *   and is the wrong gesture for a value that changed: last year's statement
 *   was computed with the old row and must stay readable.
 * - `supersedeLevy` is that gesture: it closes the current rule the day before
 *   the new validity starts and inserts the new row, its running modifiers
 *   carried over. A rate that changes every year is a chain of rows, never an
 *   overwrite.
 * - `closeLevy` ends a rule without a successor; `deleteLevy` removes one, and
 *   refuses once an expense of the activity settled it in its category over
 *   its validity (the rule is then part of the history: close it) or once
 *   another rule reads it.
 * - Modifiers assert an eligibility the engine never checks; they carry at
 *   most one duration (months, periods or an end date), and a value unless
 *   they exempt.
 * - Inputs are dated figures the engine cannot compute; restating a name on
 *   the same day replaces the value. The one in force at a date is the latest
 *   stated on or before it.
 * - Thresholds alert and never switch a regime: leaving one is a gesture.
 */

export interface NewLevy {
  activityId: string
  name: string
  kind: LevyKind
  validFrom: string
  validTo?: string | null
  sourceUrl?: string | null
  verifiedOn?: string | null
  reviewOn?: string | null
  status?: LevyStatus
  baseMeasure: LevyMeasure
  baseLevyId?: string | null
  baseInputName?: string | null
  basePeriodRef?: PeriodRef
  baseCoefficient?: number | null
  /** Validated against `abatementSchema`. */
  baseAbatement?: unknown
  baseAddBackLevyIds?: string[] | null
  baseFloor?: number | null
  baseCap?: number | null
  /** Validated against `creditsSchema`. */
  baseCredits?: unknown
  baseScale?: BaseScale
  amountForm: AmountForm
  rate?: number | null
  /** Validated against `bracketsSchema`. */
  brackets?: unknown
  /** Validated against `electiveSchema`. */
  elective?: unknown
  fixedAmount?: number | null
  fixedInputName?: string | null
  fixedCredit?: number | null
  creditInputName?: string | null
  period: LevyPeriod
  /** Validated against `dueSchema`. */
  due: unknown
  declarationLagMonths?: number | null
  firstDueAfterDays?: number | null
  /** Validated against `skipPeriodsSchema`. */
  skipPeriods?: unknown
  regularization?: Regularization
  /** Validated against `regularizationParamsSchema`. */
  regularizationParams?: unknown
  settlementCategoryId?: string | null
  deductible?: boolean
  passThrough?: boolean
  note?: string | null
}

/** Fields a correction may touch; anything absent keeps its current value. */
export type LevyEdit = Partial<Omit<NewLevy, 'activityId'>>

export type LevyWithModifiers = Levy & { modifiers: LevyModifier[] }

async function requireBusinessActivity(tx: Executor, userId: string, activityId: string): Promise<Activity> {
  const activity = await getActivity(tx, userId, activityId)
  if (!activity) throw new DomainError('activity_not_found', `No activity ${activityId} for this user`)
  if (activity.kind !== 'business')
    throw new DomainError(
      'activity_not_business',
      `Activity "${activity.name}" is personal: only a business activity carries rules, inputs and thresholds`,
    )
  return activity
}

async function requireLevy(tx: Executor, userId: string, id: string): Promise<Levy> {
  const levy = await getLevy(tx, userId, id)
  if (!levy) throw new DomainError('levy_not_found', `No rule ${id} for this user`)
  return levy
}

/** A JSON parameter, parsed by its schema so defaults land and shapes hold. */
function parseDoc<T>(schema: z.ZodType<T>, value: unknown, field: string): T | null {
  if (value === undefined || value === null) return null
  const result = schema.safeParse(value)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${[field, ...issue.path].join('.')}: ${issue.message}`)
      .join('; ')
    throw new DomainError('levy_params_invalid', `Invalid ${field}: ${issues}`)
  }
  return result.data
}

function requireValue(condition: boolean, field: string, what: string): void {
  if (!condition) throw new DomainError('levy_value_invalid', `${field} must be ${what}`)
}

/** Not "day minus one" on a Date: calendar arithmetic in UTC, no timezone drift. */
function dayBefore(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
}

/** A stored row as an input again: numerics back to numbers, ids kept. */
function fromRow(levy: Levy): NewLevy {
  const num = (v: string | null) => (v === null ? null : Number(v))
  return {
    activityId: levy.activityId,
    name: levy.name,
    kind: levy.kind,
    validFrom: levy.validFrom,
    validTo: levy.validTo,
    sourceUrl: levy.sourceUrl,
    verifiedOn: levy.verifiedOn,
    reviewOn: levy.reviewOn,
    status: levy.status,
    baseMeasure: levy.baseMeasure,
    baseLevyId: levy.baseLevyId,
    baseInputName: levy.baseInputName,
    basePeriodRef: levy.basePeriodRef,
    baseCoefficient: num(levy.baseCoefficient),
    baseAbatement: levy.baseAbatement,
    baseAddBackLevyIds: levy.baseAddBackLevyIds,
    baseFloor: num(levy.baseFloor),
    baseCap: num(levy.baseCap),
    baseCredits: levy.baseCredits,
    baseScale: levy.baseScale,
    amountForm: levy.amountForm,
    rate: num(levy.rate),
    brackets: levy.brackets,
    elective: levy.elective,
    fixedAmount: num(levy.fixedAmount),
    fixedInputName: levy.fixedInputName,
    fixedCredit: num(levy.fixedCredit),
    creditInputName: levy.creditInputName,
    period: levy.period,
    due: levy.due,
    declarationLagMonths: levy.declarationLagMonths,
    firstDueAfterDays: levy.firstDueAfterDays,
    skipPeriods: levy.skipPeriods,
    regularization: levy.regularization,
    regularizationParams: levy.regularizationParams,
    settlementCategoryId: levy.settlementCategoryId,
    deductible: levy.deductible,
    passThrough: levy.passThrough,
    note: levy.note,
  }
}

/**
 * The parameters that belong to one amount form or one base measure family.
 * When a correction changes the form, the old form's parameters are the old
 * form's: they go, so the caller does not have to null them one by one.
 */
const FORM_PARAMS: Record<AmountForm, (keyof NewLevy)[]> = {
  rate: ['rate'],
  brackets: ['brackets'],
  elective_base: ['elective'],
  fixed: ['fixedAmount', 'fixedInputName'],
  none: [],
}

function baseRefParams(measure: LevyMeasure): (keyof NewLevy)[] {
  if (measure === 'paid' || measure === 'amount') return ['baseLevyId']
  if (measure === 'input') return ['baseInputName']
  return []
}

/** Absent keys keep their value; only what the patch states changes. */
function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>
}

function merge(current: Levy, patch: LevyEdit): NewLevy {
  const base: Record<string, unknown> = { ...fromRow(current) }
  if (patch.amountForm && patch.amountForm !== current.amountForm)
    for (const key of FORM_PARAMS[current.amountForm]) base[key] = null
  if (patch.baseMeasure && patch.baseMeasure !== current.baseMeasure)
    for (const key of baseRefParams(current.baseMeasure)) base[key] = null
  return { ...base, ...defined(patch) } as NewLevy
}

/**
 * Turns an input into the row to write, or refuses. Every rule the input
 * references is checked to belong to the user and to the same activity;
 * `selfId` is the row being corrected, which may not read itself.
 */
async function normalize(
  tx: Executor,
  userId: string,
  input: NewLevy,
  selfId?: string,
): Promise<Record<string, unknown>> {
  await requireBusinessActivity(tx, userId, input.activityId)
  const name = input.name.trim()
  if (!name) throw new DomainError('levy_value_invalid', 'name must be given')
  if (input.validTo && input.validTo < input.validFrom)
    throw new DomainError(
      'levy_validity',
      `validTo (${input.validTo}) is before validFrom (${input.validFrom})`,
    )

  const measure = input.baseMeasure
  const wantsLevy = measure === 'paid' || measure === 'amount'
  if (wantsLevy && !input.baseLevyId)
    throw new DomainError(
      'levy_base_needs_levy',
      `Base measure "${measure}" names the rule it reads: pass baseLevyId`,
    )
  if (!wantsLevy && input.baseLevyId)
    throw new DomainError(
      'levy_base_levy_unexpected',
      `Base measure "${measure}" reads no other rule: drop baseLevyId`,
    )
  if (measure === 'input' && !input.baseInputName?.trim())
    throw new DomainError(
      'levy_base_needs_input',
      'Base measure "input" names the stated figure it reads: pass baseInputName',
    )
  if (measure !== 'input' && input.baseInputName)
    throw new DomainError(
      'levy_base_input_unexpected',
      `Base measure "${measure}" reads no stated figure: drop baseInputName`,
    )

  const form = input.amountForm
  const has = (key: keyof NewLevy) => input[key] !== undefined && input[key] !== null && input[key] !== ''
  const needed: Partial<Record<AmountForm, string>> = {
    rate: 'rate',
    brackets: 'brackets',
    elective_base: 'elective',
  }
  const need = needed[form]
  if (need && !has(need as keyof NewLevy))
    throw new DomainError('levy_form_needs_param', `Amount form "${form}" needs ${need}`)
  if (form === 'fixed' && !has('fixedAmount') && !has('fixedInputName'))
    throw new DomainError('levy_form_needs_param', 'Amount form "fixed" needs fixedAmount or fixedInputName')
  for (const [other, keys] of Object.entries(FORM_PARAMS) as [AmountForm, (keyof NewLevy)[]][]) {
    if (other === form) continue
    for (const key of keys)
      if (has(key))
        throw new DomainError(
          'levy_form_param_unexpected',
          `${key} belongs to amount form "${other}", not "${form}"`,
        )
  }

  if (input.rate != null)
    requireValue(input.rate >= 0 && input.rate <= 100, 'rate', 'a percentage between 0 and 100')
  if (input.baseCoefficient != null) requireValue(input.baseCoefficient > 0, 'baseCoefficient', 'above zero')
  if (input.baseFloor != null) requireValue(input.baseFloor >= 0, 'baseFloor', 'zero or more')
  if (input.baseCap != null) requireValue(input.baseCap >= 0, 'baseCap', 'zero or more')
  if (input.baseFloor != null && input.baseCap != null)
    requireValue(input.baseFloor <= input.baseCap, 'baseFloor', 'at most baseCap')
  if (input.fixedAmount != null) requireValue(input.fixedAmount >= 0, 'fixedAmount', 'zero or more')
  if (input.fixedCredit != null) requireValue(input.fixedCredit >= 0, 'fixedCredit', 'zero or more')
  if (input.declarationLagMonths != null)
    requireValue(
      Number.isInteger(input.declarationLagMonths) && input.declarationLagMonths >= 0,
      'declarationLagMonths',
      'a whole number of months, zero or more',
    )
  if (input.firstDueAfterDays != null)
    requireValue(
      Number.isInteger(input.firstDueAfterDays) && input.firstDueAfterDays >= 0,
      'firstDueAfterDays',
      'a whole number of days, zero or more',
    )

  const due = parseDoc(dueSchema, input.due, 'due')
  if (!due)
    throw new DomainError('levy_params_invalid', 'due is required: when is a period of this rule payable?')
  const credits = parseDoc(creditsSchema, input.baseCredits, 'baseCredits') as
    | { source: string; levyId?: string }[]
    | null

  // Every rule read by this one: its base, its add-backs, its credits.
  const referenced = new Set<string>()
  if (input.baseLevyId) referenced.add(input.baseLevyId)
  for (const id of input.baseAddBackLevyIds ?? []) referenced.add(id)
  for (const credit of credits ?? []) {
    if (credit.source !== 'withholdings' && !credit.levyId)
      throw new DomainError(
        'levy_params_invalid',
        `Invalid baseCredits: a credit of source "${credit.source}" names the rule it reads (levyId)`,
      )
    if (credit.levyId) referenced.add(credit.levyId)
  }
  for (const id of referenced) {
    if (id === selfId) throw new DomainError('base_levy_self', 'A rule cannot read itself')
    const other = await getLevy(tx, userId, id)
    if (!other) throw new DomainError('base_levy_not_found', `No rule ${id} for this user`)
    if (other.activityId !== input.activityId)
      throw new DomainError(
        'base_levy_other_activity',
        `Rule "${other.name}" belongs to another activity: a rule only reads the rules of its own activity`,
      )
  }
  if (input.settlementCategoryId && !(await getCategory(tx, userId, input.settlementCategoryId)))
    throw new DomainError('category_not_found', `No category ${input.settlementCategoryId} for this user`)

  return {
    userId,
    activityId: input.activityId,
    name,
    kind: input.kind,
    validFrom: input.validFrom,
    validTo: input.validTo ?? null,
    sourceUrl: input.sourceUrl?.trim() || null,
    verifiedOn: input.verifiedOn ?? null,
    reviewOn: input.reviewOn ?? null,
    status: input.status ?? 'confirmed',
    baseMeasure: measure,
    baseLevyId: input.baseLevyId ?? null,
    baseInputName: input.baseInputName?.trim() || null,
    basePeriodRef: input.basePeriodRef ?? 'current',
    baseCoefficient: input.baseCoefficient ?? null,
    baseAbatement: parseDoc(abatementSchema, input.baseAbatement, 'baseAbatement'),
    baseAddBackLevyIds: input.baseAddBackLevyIds?.length ? input.baseAddBackLevyIds : null,
    baseFloor: input.baseFloor ?? null,
    baseCap: input.baseCap ?? null,
    baseCredits: credits?.length ? credits : null,
    baseScale: input.baseScale ?? 'none',
    amountForm: form,
    rate: input.rate ?? null,
    brackets: parseDoc(bracketsSchema, input.brackets, 'brackets'),
    elective: parseDoc(electiveSchema, input.elective, 'elective'),
    fixedAmount: input.fixedAmount ?? null,
    fixedInputName: input.fixedInputName?.trim() || null,
    fixedCredit: input.fixedCredit ?? null,
    creditInputName: input.creditInputName?.trim() || null,
    period: input.period,
    due,
    declarationLagMonths: input.declarationLagMonths ?? null,
    firstDueAfterDays: input.firstDueAfterDays ?? null,
    skipPeriods: parseDoc(skipPeriodsSchema, input.skipPeriods, 'skipPeriods'),
    regularization: input.regularization ?? 'none',
    regularizationParams: parseDoc(
      regularizationParamsSchema,
      input.regularizationParams,
      'regularizationParams',
    ),
    settlementCategoryId: input.settlementCategoryId ?? null,
    deductible: input.deductible ?? false,
    passThrough: input.passThrough ?? false,
    note: input.note?.trim() || null,
  }
}

export async function createLevy(userId: string, input: NewLevy): Promise<Levy> {
  return await db().begin(async (tx) => await insertLevy(tx, await normalize(tx, userId, input)))
}

/** Corrects a mistyped rule in place. A value that changed is `supersedeLevy`. */
export async function editLevy(userId: string, id: string, patch: LevyEdit): Promise<Levy> {
  return await db().begin(async (tx) => {
    const current = await requireLevy(tx, userId, id)
    const row = await normalize(tx, userId, merge(current, patch), id)
    delete row.userId
    delete row.activityId
    return (await updateLevyRow(tx, userId, id, row))!
  })
}

/**
 * The rule changes from a date: the current row closes the day before, a new
 * row starts that day, with the current values unless `changes` say otherwise
 * and the modifiers still running carried over. The old row keeps computing
 * the periods it covered.
 */
export async function supersedeLevy(
  userId: string,
  id: string,
  changes: LevyEdit & { validFrom: string },
): Promise<{ closed: Levy; created: Levy }> {
  return await db().begin(async (tx) => {
    const current = await requireLevy(tx, userId, id)
    if (changes.validFrom <= current.validFrom)
      throw new DomainError(
        'supersede_before_start',
        `The new rule would start on ${changes.validFrom}, not after the current one (${current.validFrom})`,
      )
    const closeOn = dayBefore(changes.validFrom)
    const closed = (await updateLevyRow(tx, userId, id, {
      validTo: current.validTo && current.validTo < closeOn ? current.validTo : closeOn,
    }))!
    const created = await insertLevy(
      tx,
      await normalize(tx, userId, merge(current, { validTo: null, ...changes })),
    )
    for (const m of await listModifiers(tx, [id])) {
      if (m.endsOn && m.endsOn < changes.validFrom) continue
      await insertModifier(tx, {
        levyId: created.id,
        label: m.label,
        effect: m.effect,
        value: m.value,
        startsOn: m.startsOn,
        durationMonths: m.durationMonths,
        durationPeriods: m.durationPeriods,
        endsOn: m.endsOn,
        condition: m.condition,
        sourceUrl: m.sourceUrl,
        verifiedOn: m.verifiedOn,
        status: m.status,
      })
    }
    return { closed, created }
  })
}

export async function closeLevy(userId: string, id: string, validTo: string): Promise<Levy> {
  return await db().begin(async (tx) => {
    const current = await requireLevy(tx, userId, id)
    if (validTo < current.validFrom)
      throw new DomainError(
        'levy_validity',
        `validTo (${validTo}) is before validFrom (${current.validFrom})`,
      )
    return (await updateLevyRow(tx, userId, id, { validTo }))!
  })
}

export async function deleteLevy(userId: string, id: string): Promise<void> {
  await db().begin(async (tx) => {
    const levy = await requireLevy(tx, userId, id)
    if ((await countLevyReferences(tx, id)) > 0)
      throw new DomainError(
        'levy_referenced',
        `Another rule reads "${levy.name}" as its base, add-back or credit`,
      )
    if (
      levy.settlementCategoryId &&
      (await countSettlements(tx, levy.activityId, levy.settlementCategoryId, levy.validFrom, levy.validTo)) >
        0
    )
      throw new DomainError(
        'levy_has_settlements',
        `Rule "${levy.name}" has been settled: it is part of the history`,
      )
    await deleteLevyRow(tx, userId, id)
  })
}

export async function listLevies(
  userId: string,
  activityId: string,
  options: { at?: string } = {},
): Promise<LevyWithModifiers[]> {
  const sql = db()
  const levies = await listLeviesDs(sql, userId, activityId, options.at)
  const modifiers = await listModifiers(
    sql,
    levies.map((levy) => levy.id),
  )
  return levies.map((levy) => ({
    ...levy,
    modifiers: modifiers.filter((modifier) => modifier.levyId === levy.id),
  }))
}

export interface NewModifier {
  label: string
  effect: ModifierEffect
  value?: number | null
  startsOn?: string | null
  durationMonths?: number | null
  durationPeriods?: number | null
  endsOn?: string | null
  condition?: string | null
  sourceUrl?: string | null
  verifiedOn?: string | null
  status?: LevyStatus
}

export type ModifierEdit = Partial<NewModifier>

function checkModifier(input: NewModifier): Record<string, unknown> {
  const label = input.label.trim()
  if (!label) throw new DomainError('modifier_value_invalid', 'label must be given')
  const value = input.effect === 'exempt' ? null : input.value
  if (input.effect !== 'exempt' && value == null)
    throw new DomainError('modifier_needs_value', `Effect "${input.effect}" needs a value`)
  if (value != null) {
    if (input.effect === 'replace_amount') {
      if (value < 0) throw new DomainError('modifier_value_invalid', 'value must be zero or more')
    } else if (value <= 0) throw new DomainError('modifier_value_invalid', 'value must be above zero')
  }
  const durations = [input.durationMonths, input.durationPeriods, input.endsOn].filter((d) => d != null)
  if (durations.length > 1)
    throw new DomainError(
      'modifier_single_duration',
      'A modifier carries one duration: months, periods or an end date',
    )
  for (const [key, count] of [
    ['durationMonths', input.durationMonths],
    ['durationPeriods', input.durationPeriods],
  ] as const)
    if (count != null && (!Number.isInteger(count) || count <= 0))
      throw new DomainError('modifier_value_invalid', `${key} must be a whole number above zero`)
  if (input.startsOn && input.endsOn && input.endsOn < input.startsOn)
    throw new DomainError('modifier_value_invalid', 'endsOn is before startsOn')
  return {
    label,
    effect: input.effect,
    value: value ?? null,
    startsOn: input.startsOn ?? null,
    durationMonths: input.durationMonths ?? null,
    durationPeriods: input.durationPeriods ?? null,
    endsOn: input.endsOn ?? null,
    condition: input.condition?.trim() || null,
    sourceUrl: input.sourceUrl?.trim() || null,
    verifiedOn: input.verifiedOn ?? null,
    status: input.status ?? 'confirmed',
  }
}

export async function addModifier(userId: string, levyId: string, input: NewModifier): Promise<LevyModifier> {
  return await db().begin(async (tx) => {
    await requireLevy(tx, userId, levyId)
    return await insertModifier(tx, { ...checkModifier(input), levyId })
  })
}

async function requireModifier(tx: Executor, userId: string, id: string): Promise<LevyModifier> {
  const modifier = await getModifier(tx, userId, id)
  if (!modifier) throw new DomainError('modifier_not_found', `No modifier ${id} for this user`)
  return modifier
}

export async function editModifier(userId: string, id: string, patch: ModifierEdit): Promise<LevyModifier> {
  return await db().begin(async (tx) => {
    const current = await requireModifier(tx, userId, id)
    // A patch that sets one duration replaces whichever the row held: the
    // rule is "one duration", not "the first one typed wins forever".
    const durationPatched =
      patch.durationMonths != null || patch.durationPeriods != null || patch.endsOn != null
    const merged: NewModifier = {
      label: current.label,
      effect: current.effect,
      value: current.value === null ? null : Number(current.value),
      startsOn: current.startsOn,
      durationMonths: durationPatched ? null : current.durationMonths,
      durationPeriods: durationPatched ? null : current.durationPeriods,
      endsOn: durationPatched ? null : current.endsOn,
      condition: current.condition,
      sourceUrl: current.sourceUrl,
      verifiedOn: current.verifiedOn,
      status: current.status,
      ...defined(patch),
    }
    return (await updateModifierRow(tx, id, checkModifier(merged)))!
  })
}

export async function removeModifier(userId: string, id: string): Promise<void> {
  await db().begin(async (tx) => {
    await requireModifier(tx, userId, id)
    await deleteModifierRow(tx, id)
  })
}

export interface NewInput {
  name: string
  validFrom: string
  value: number
  note?: string | null
}

export async function setInput(userId: string, activityId: string, input: NewInput): Promise<ActivityInput> {
  return await db().begin(async (tx) => {
    await requireBusinessActivity(tx, userId, activityId)
    const name = input.name.trim()
    if (!name) throw new DomainError('input_value_invalid', 'name must be given')
    if (!Number.isFinite(input.value)) throw new DomainError('input_value_invalid', 'value must be a number')
    return await upsertInput(tx, {
      userId,
      activityId,
      name,
      validFrom: input.validFrom,
      value: input.value,
      note: input.note?.trim() || null,
    })
  })
}

export async function listInputs(userId: string, activityId: string): Promise<ActivityInput[]> {
  return await listInputsDs(db(), userId, activityId)
}

/** The figure a name holds at a date, or null when none was stated by then. */
export async function inputInForce(
  userId: string,
  activityId: string,
  name: string,
  at: string,
): Promise<ActivityInput | null> {
  return (await inputAt(db(), userId, activityId, name, at)) ?? null
}

export async function removeInput(userId: string, id: string): Promise<void> {
  await db().begin(async (tx) => {
    if (!(await getInput(tx, userId, id)))
      throw new DomainError('input_not_found', `No input ${id} for this user`)
    await deleteInputRow(tx, userId, id)
  })
}

export interface NewThreshold {
  label: string
  measure: ThresholdMeasure
  periodRef?: PeriodRef
  comparison?: 'lte' | 'gte'
  value: number
  consequence: string
  sourceUrl?: string | null
  verifiedOn?: string | null
  reviewOn?: string | null
}

export type ThresholdEdit = Partial<NewThreshold>

function checkThreshold(input: NewThreshold): Record<string, unknown> {
  const label = input.label.trim()
  const consequence = input.consequence.trim()
  if (!label) throw new DomainError('threshold_value_invalid', 'label must be given')
  if (!consequence)
    throw new DomainError('threshold_value_invalid', 'consequence must say what changes past the value')
  if (!Number.isFinite(input.value))
    throw new DomainError('threshold_value_invalid', 'value must be a number')
  return {
    label,
    measure: input.measure,
    periodRef: input.periodRef ?? 'ytd',
    comparison: input.comparison ?? 'lte',
    value: input.value,
    consequence,
    sourceUrl: input.sourceUrl?.trim() || null,
    verifiedOn: input.verifiedOn ?? null,
    reviewOn: input.reviewOn ?? null,
  }
}

export async function createThreshold(
  userId: string,
  activityId: string,
  input: NewThreshold,
): Promise<Threshold> {
  return await db().begin(async (tx) => {
    await requireBusinessActivity(tx, userId, activityId)
    return await insertThreshold(tx, { ...checkThreshold(input), userId, activityId })
  })
}

export async function editThreshold(userId: string, id: string, patch: ThresholdEdit): Promise<Threshold> {
  return await db().begin(async (tx) => {
    const current = await getThreshold(tx, userId, id)
    if (!current) throw new DomainError('threshold_not_found', `No threshold ${id} for this user`)
    const merged: NewThreshold = {
      label: current.label,
      measure: current.measure,
      periodRef: current.periodRef,
      comparison: current.comparison,
      value: Number(current.value),
      consequence: current.consequence,
      sourceUrl: current.sourceUrl,
      verifiedOn: current.verifiedOn,
      reviewOn: current.reviewOn,
      ...defined(patch),
    }
    return (await updateThresholdRow(tx, userId, id, checkThreshold(merged)))!
  })
}

export async function removeThreshold(userId: string, id: string): Promise<void> {
  await db().begin(async (tx) => {
    if (!(await getThreshold(tx, userId, id)))
      throw new DomainError('threshold_not_found', `No threshold ${id} for this user`)
    await deleteThresholdRow(tx, userId, id)
  })
}

export async function listThresholds(userId: string, activityId: string): Promise<Threshold[]> {
  return await listThresholdsDs(db(), userId, activityId)
}
