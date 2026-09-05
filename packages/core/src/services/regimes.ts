import { db } from '../db/client.ts'
import { insertCategory, listCategories as listCategoriesDs } from '../db/datasources/catalog.ts'
import { DomainError, rethrowUnique } from '../domain/errors.ts'
import {
  type Answers,
  excluded,
  type Jurisdiction,
  type Parameter,
  questionsIn,
  type RegimeLevyTemplate,
  type RegimeModel,
  type RegimeModifierTemplate,
  type RegimeQuestion,
  type RegimeSource,
  resolveParameter,
  satisfies,
} from '../domain/regime.ts'
import type { Activity, ActivityInput, Levy, LevyStatus, Threshold } from '../domain/types.ts'
import { catalog } from '../regimes/index.ts'
import { createActivityIn, type NewActivity } from './catalog.ts'
import {
  addModifierIn,
  createLevyIn,
  createThresholdIn,
  type NewInput,
  type NewLevy,
  type NewModifier,
  type NewThreshold,
  setInputIn,
} from './levies.ts'

/**
 * The regime catalog, the questionnaire that leads to one of its models, and
 * what applying a model writes (issue #90, part of #82).
 *
 * A model is public reference data, dated and sourced, shipped with the
 * repository under packages/core/src/regimes. What an activity takes from one
 * is a **copy**: rules the user owns, corrects and supersedes, with no living
 * link back. That is deliberate and it is the whole point. A regime is read at
 * one moment, from texts in force that day; correcting the catalog next year,
 * or fixing a mistake in it, must leave every activity already created exactly
 * as it was, because a statement computed last year has to stay readable with
 * the figures it was computed with. A model is a dated starting point, never a
 * truth, and never a subscription.
 *
 * The engine here knows nothing of what it asks. It walks a tree of questions,
 * narrows the candidate models, resolves the parameters an answer fills in,
 * and copies a document. No country, no rate and no rule is named in this file;
 * a branch on a jurisdiction would put back into the code what migration 0018
 * took out of it.
 *
 * What the three gestures guarantee:
 * - `questionnaire` asks the next question whose own condition the answers
 *   satisfy and that still decides something: an answer narrowing the
 *   candidates, or a figure one of them reads. It stops when nothing is left
 *   to ask, which is when one model stands with every parameter it needs.
 * - `previewRegime` writes nothing. It returns the activity, the rules, the
 *   thresholds and the stated figures a model would create, each carrying the
 *   text it comes from, the day it was checked and its status: `confirmed`,
 *   `extended_by_default` where a lapsed text is still applied,
 *   `unconfirmed` where no text fixes the value at all. Refused before it
 *   builds anything: an unknown jurisdiction or model, an answer no option
 *   declares, a model the answers rule out, a question left unanswered that
 *   the model reads.
 * - `applyRegime` writes all of it in one transaction, or none of it: a
 *   half-configured regime would compute figures without saying they are
 *   partial. Every rule is validated by createLevy like any hand-typed one.
 */

export interface RegimeModelSummary {
  id: string
  /** French, as the person reads it; it becomes the activity's regime label. */
  name: string
  description: string
  source: RegimeSource
}

export interface JurisdictionSummary {
  id: string
  /** French; it becomes the activity's jurisdiction. */
  name: string
  description: string
  models: RegimeModelSummary[]
}

/** Where the questionnaire stands: what is asked next, and what is still open. */
export interface QuestionnaireStep {
  jurisdiction: { id: string; name: string }
  answers: Answers
  /** The next question, or null when nothing is left to ask. */
  question: RegimeQuestion | null
  /** The models the answers still allow, in catalog order. */
  models: RegimeModelSummary[]
  done: boolean
}

/** A rule as it would be written, minus the activity that does not exist yet. */
export type RegimeLevy = Omit<NewLevy, 'activityId'>

export interface PreviewLevy {
  levy: RegimeLevy
  modifiers: NewModifier[]
  /**
   * The category this rule's payments are filed under, by name: the category
   * may not exist yet, and applying the model is what creates or reuses it.
   * Without it the engine would never learn that a levy was paid, and its
   * reserve would stay up forever.
   */
  settlementCategory?: string
}

/**
 * A threshold as it would be written. Its status rides alongside rather than
 * in the row: a threshold alerts and computes nothing, so the schema keeps
 * only its source and its check dates.
 */
export type PreviewThreshold = NewThreshold & { status: LevyStatus }

/** What the activity is created with; the name and the accounts are the caller's. */
export type RegimeActivity = Omit<NewActivity, 'name' | 'accountIds' | 'startedOn'>

export interface RegimePreview {
  jurisdiction: { id: string; name: string }
  model: RegimeModelSummary
  activity: RegimeActivity
  levies: PreviewLevy[]
  thresholds: PreviewThreshold[]
  inputs: NewInput[]
}

export interface ApplyRegime {
  /** The activity's name, which the catalog never decides. */
  name: string
  /** A model id names one model in the whole catalog. */
  modelId: string
  answers: Answers
  startedOn?: string | null
  accountIds?: string[]
}

export interface AppliedRegime {
  activity: Activity
  levies: Levy[]
  thresholds: Threshold[]
  inputs: ActivityInput[]
}

export function listJurisdictions(): JurisdictionSummary[] {
  return catalog().map((jurisdiction) => ({
    id: jurisdiction.id,
    name: jurisdiction.name,
    description: jurisdiction.description,
    models: jurisdiction.models.map(summarize),
  }))
}

function summarize(model: RegimeModel): RegimeModelSummary {
  return {
    id: model.id,
    name: model.name,
    description: model.description,
    source: model.source,
  }
}

function jurisdictionOf(id: string): Jurisdiction {
  const found = catalog().find((jurisdiction) => jurisdiction.id === id)
  if (!found)
    throw new DomainError(
      'jurisdiction_not_found',
      `No jurisdiction "${id}" in the catalog: ${catalog()
        .map((j) => j.id)
        .join(', ')}`,
    )
  return found
}

/**
 * An answer that names no question, or no option of it, is a typo, not a
 * choice. An answer left undefined is no answer: a caller building its state
 * from a form holds the key before it holds the value.
 */
function checkAnswers(jurisdiction: Jurisdiction, answers: Answers): void {
  for (const [id, value] of Object.entries(answers)) {
    if (value === undefined) continue
    const question = jurisdiction.questions.find((q) => q.id === id)
    if (!question)
      throw new DomainError('regime_answer_unknown', `"${jurisdiction.name}" asks no question "${id}"`)
    if (!question.options.some((option) => option.value === value))
      throw new DomainError(
        'regime_answer_unknown',
        `Question "${question.label}" has no answer "${value}": ${question.options.map((o) => o.value).join(', ')}`,
      )
  }
}

/** The models no answer already given rules out. */
function candidates(models: RegimeModel[], answers: Answers): RegimeModel[] {
  return models.filter((model) => !excluded(model.when, answers))
}

/**
 * The questions a model reads to write its rules: the parameters an answer
 * fills in, and the conditions that let a rule, a modifier or a threshold in.
 * Its own `when` is not one of them: that one narrows the choice of models,
 * which is the other kind of question entirely.
 */
function reads(model: RegimeModel): Set<string> {
  return questionsIn({
    activity: model.activity,
    levies: model.levies,
    thresholds: model.thresholds,
    inputs: model.inputs,
  })
}

/** Whether one of the answers to this question would drop a candidate. */
function narrows(models: RegimeModel[], question: RegimeQuestion, answers: Answers): boolean {
  if (models.length <= 1) return false
  return question.options.some(
    (option) => candidates(models, { ...answers, [question.id]: option.value }).length < models.length,
  )
}

/**
 * What is left to ask: a question still unanswered, whose own condition the
 * answers satisfy, and that either narrows the candidates or fills a figure
 * one of them reads. A question nothing left standing reads has nothing to
 * decide, which is how the walk ends on its own.
 */
function stillOpen(jurisdiction: Jurisdiction, answers: Answers): RegimeQuestion[] {
  const models = candidates(jurisdiction.models, answers)
  const read = new Set<string>()
  for (const model of models) for (const question of reads(model)) read.add(question)
  return jurisdiction.questions.filter(
    (question) =>
      answers[question.id] === undefined &&
      satisfies(question.when, answers) &&
      (read.has(question.id) || narrows(models, question, answers)),
  )
}

/**
 * The next question, or the models the answers leave standing. The state is
 * the answers themselves: nothing is stored between two calls, so a caller may
 * go back by dropping an answer.
 */
export function questionnaire(jurisdictionId: string, answers: Answers = {}): QuestionnaireStep {
  const jurisdiction = jurisdictionOf(jurisdictionId)
  checkAnswers(jurisdiction, answers)
  const open = stillOpen(jurisdiction, answers)
  return {
    jurisdiction: { id: jurisdiction.id, name: jurisdiction.name },
    answers,
    question: open[0] ?? null,
    models: candidates(jurisdiction.models, answers).map(summarize),
    done: open.length === 0,
  }
}

/** A model id names one model in the whole catalog, so it needs no jurisdiction beside it. */
function modelOf(modelId: string): { jurisdiction: Jurisdiction; model: RegimeModel } {
  for (const jurisdiction of catalog()) {
    const model = jurisdiction.models.find((candidate) => candidate.id === modelId)
    if (model) return { jurisdiction, model }
  }
  throw new DomainError(
    'regime_model_not_found',
    `No regime model "${modelId}" in the catalog: ${catalog()
      .flatMap((j) => j.models.map((m) => m.id))
      .join(', ')}`,
  )
}

export function previewRegime(modelId: string, answers: Answers = {}): RegimePreview {
  const { jurisdiction, model } = modelOf(modelId)
  checkAnswers(jurisdiction, answers)
  if (excluded(model.when, answers))
    throw new DomainError(
      'regime_model_excluded',
      `The answers given rule out "${model.name}". Walk the questionnaire again, or drop the answer that excludes it.`,
    )
  const needed = new Set([...reads(model), ...Object.keys(model.when ?? {})])
  const missing = jurisdiction.questions.find(
    (question) =>
      needed.has(question.id) && answers[question.id] === undefined && satisfies(question.when, answers),
  )
  if (missing)
    throw new DomainError(
      'regime_answers_incomplete',
      `"${model.name}" reads an answer to "${missing.label}" (${missing.id}), which has none yet`,
    )

  const value = <T>(parameter: Parameter<T> | undefined): T | undefined =>
    parameter === undefined ? undefined : resolveParameter(parameter, answers)
  const kept = <T extends { when?: Record<string, string[]> }>(items: T[]): T[] =>
    items.filter((item) => satisfies(item.when, answers))

  const activity: RegimeActivity = {
    kind: 'business',
    jurisdiction: jurisdiction.name,
    regimeLabel: model.name,
    fiscalYearStartMonth: model.activity.fiscalYearStartMonth,
    fiscalYearStartDay: model.activity.fiscalYearStartDay,
    revenueBasis: model.activity.revenueBasis,
    vatRegistered: value(model.activity.vatRegistered),
    defaultVatRate: value(model.activity.defaultVatRate),
    deductibleExpenses: model.activity.deductibleExpenses,
    currency: model.activity.currency,
  }

  return structuredClone({
    jurisdiction: { id: jurisdiction.id, name: jurisdiction.name },
    model: summarize(model),
    activity,
    levies: kept(model.levies).map((template) => ({
      levy: buildLevy(template, answers),
      settlementCategory: template.settlementCategory,
      modifiers: kept(template.modifiers ?? []).map((modifier) => buildModifier(modifier, answers)),
    })),
    thresholds: kept(model.thresholds).map((template) => ({
      label: template.label,
      measure: template.measure,
      periodRef: template.periodRef,
      comparison: template.comparison,
      value: value(template.value)!,
      consequence: template.consequence,
      sourceUrl: template.source.url,
      verifiedOn: template.source.verifiedOn,
      reviewOn: template.source.reviewOn,
      status: template.source.status,
    })),
    inputs: kept(model.inputs).map((template) => ({
      name: template.name,
      validFrom: template.validFrom,
      value: value(template.value)!,
      note: template.note,
    })),
  })

  function buildLevy(template: RegimeLevyTemplate, given: Answers): RegimeLevy {
    const at = <T>(parameter: Parameter<T> | undefined): T | undefined =>
      parameter === undefined ? undefined : resolveParameter(parameter, given)
    return {
      name: template.name,
      kind: template.kind,
      validFrom: template.validFrom,
      validTo: template.validTo,
      sourceUrl: template.source.url,
      verifiedOn: template.source.verifiedOn,
      reviewOn: template.source.reviewOn,
      status: template.source.status,
      baseMeasure: template.baseMeasure,
      baseInputName: template.baseInputName,
      basePeriodRef: template.basePeriodRef,
      baseCoefficient: at(template.baseCoefficient),
      baseAbatement: at(template.baseAbatement),
      baseFloor: at(template.baseFloor),
      baseCap: at(template.baseCap),
      baseCredits: template.baseCredits,
      baseScale: template.baseScale,
      amountForm: template.amountForm,
      rate: at(template.rate),
      brackets: template.brackets,
      elective: template.elective,
      fixedAmount: at(template.fixedAmount),
      fixedInputName: template.fixedInputName,
      fixedCredit: at(template.fixedCredit),
      creditInputName: template.creditInputName,
      period: at(template.period)!,
      due: at(template.due)!,
      declarationLagMonths: template.declarationLagMonths,
      firstDueAfterDays: template.firstDueAfterDays,
      skipPeriods: template.skipPeriods,
      regularization: template.regularization,
      regularizationParams: template.regularizationParams,
      deductible: template.deductible,
      passThrough: template.passThrough,
      note: template.note,
    }
  }

  function buildModifier(template: RegimeModifierTemplate, given: Answers): NewModifier {
    const at = <T>(parameter: Parameter<T> | undefined): T | undefined =>
      parameter === undefined ? undefined : resolveParameter(parameter, given)
    return {
      label: template.label,
      effect: template.effect,
      value: at(template.value),
      startsOn: template.startsOn,
      durationMonths: at(template.durationMonths),
      durationPeriods: at(template.durationPeriods),
      endsOn: template.endsOn,
      condition: template.condition,
      sourceUrl: template.source.url,
      verifiedOn: template.source.verifiedOn,
      status: template.source.status,
    }
  }
}

/**
 * Creates the activity and everything the model would write, in one
 * transaction. From this moment the rules belong to the user: correcting the
 * catalog will never reach them, and correcting them will never reach the
 * catalog.
 */
export async function applyRegime(userId: string, input: ApplyRegime): Promise<AppliedRegime> {
  const preview = previewRegime(input.modelId, input.answers)
  const sql = db()
  try {
    return await sql.begin(async (tx) => {
      const activity = await createActivityIn(tx, userId, {
        name: input.name,
        startedOn: input.startedOn,
        ...preview.activity,
        accountIds: input.accountIds,
      })
      // The categories the model files its payments under, created once each
      // and reused when the user already keeps one by that name: a rule
      // without one would never see itself paid.
      const byName = new Map((await listCategoriesDs(tx, userId)).map((c) => [c.name.toLowerCase(), c.id]))
      const categoryId = async (name: string | undefined): Promise<string | undefined> => {
        if (!name) return undefined
        const known = byName.get(name.toLowerCase())
        if (known) return known
        const created = await insertCategory(tx, userId, name, null)
        byName.set(name.toLowerCase(), created.id)
        return created.id
      }

      const levies: Levy[] = []
      for (const entry of preview.levies) {
        const levy = await createLevyIn(tx, userId, {
          ...entry.levy,
          activityId: activity.id,
          settlementCategoryId: await categoryId(entry.settlementCategory),
        })
        for (const modifier of entry.modifiers) await addModifierIn(tx, userId, levy.id, modifier)
        levies.push(levy)
      }
      const thresholds: Threshold[] = []
      for (const { status: _status, ...threshold } of preview.thresholds)
        thresholds.push(await createThresholdIn(tx, userId, activity.id, threshold))
      const inputs: ActivityInput[] = []
      for (const stated of preview.inputs) inputs.push(await setInputIn(tx, userId, activity.id, stated))
      return { activity, levies, thresholds, inputs }
    })
  } catch (e) {
    rethrowUnique(e, 'activity_exists', `An activity already uses the name "${input.name}"`)
  }
}
