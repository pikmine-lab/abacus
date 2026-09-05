import * as z from 'zod'
import {
  abatementSchema,
  bracketsSchema,
  creditsSchema,
  dueSchema,
  electiveSchema,
  regularizationParamsSchema,
  skipPeriodsSchema,
} from './levy.ts'

/**
 * The shape of a regime model and of the questionnaire that leads to one
 * (issue #90). This is the contract of the data files under
 * packages/core/src/regimes: they are parsed with these schemas on load, so the
 * engine reads a document it never has to second-guess.
 *
 * A model is public reference data, like a quoted instrument: nobody owns it,
 * it carries the text it comes from, the day it was checked and the day it
 * should be checked again. Nothing in it names a country, a rate or a rule to
 * the code: the code walks a tree of questions and copies a document, and every
 * figure lives in a data file.
 *
 * Three effects an answer may have, and no fourth: it narrows the candidate
 * models (`when` on a model), it fills a parameter of one (`answered`, a table
 * read with the answer), or it lets a rule in or leaves it out (`when` on a
 * levy, a modifier, a threshold or an input). Everything else the tree could be
 * asked to do would be a branch in the code.
 *
 * What the grammar of a model deliberately cannot express: a rule reading
 * another rule (base measures `paid` and `amount`, add-backs). Those need ids
 * that only exist once the rules are written, and no jurisdiction shipped here
 * needs one; a user adds it afterwards, on rules they own.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a day written YYYY-MM-DD')
/** Ids are read by the code alone, so they are code-shaped: lowercase, no spaces. */
const identifier = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, 'lowercase letters, digits, - and _')
const percent = z.number().min(0).max(100)

/**
 * A value the questionnaire fills in: the table is read with the answer to
 * `question`. An answer with no case leaves the field unstated, which is what
 * lets a question that is never asked leave a field out.
 */
function answered<T extends z.ZodType>(value: T) {
  return z.object({ question: identifier, cases: z.record(identifier, value) })
}

/** Either the value itself, or the table an answer picks it from. */
function parameter<T extends z.ZodType>(value: T) {
  return z.union([value, answered(value)])
}

export type Answered<T> = { question: string; cases: Record<string, T> }
export type Parameter<T> = T | Answered<T>

/** Answers given so far: one option value per question id. */
export type Answers = Record<string, string>

/**
 * What must already have been answered for something to apply: for each
 * question named, the answers that let it in. A question not yet answered
 * leaves the condition undecided, which is what makes a tree of questions
 * possible at all.
 */
const conditionSchema = z.record(identifier, z.array(identifier).min(1))
export type RegimeCondition = Record<string, string[]>

const sourceSchema = z.object({
  url: z.url().optional(),
  verifiedOn: isoDate,
  reviewOn: isoDate.optional(),
  status: z.enum(['confirmed', 'extended_by_default', 'unconfirmed']).default('confirmed'),
})
export type RegimeSource = z.infer<typeof sourceSchema>

const optionSchema = z.object({
  value: identifier,
  /** French: the person reads it. */
  label: z.string().min(1),
  help: z.string().optional(),
})
export type RegimeOption = z.infer<typeof optionSchema>

const questionSchema = z.object({
  id: identifier,
  label: z.string().min(1),
  help: z.string().optional(),
  when: conditionSchema.optional(),
  options: z.array(optionSchema).min(2),
})
export type RegimeQuestion = z.infer<typeof questionSchema>

const modifierTemplateSchema = z.object({
  when: conditionSchema.optional(),
  label: z.string().min(1),
  effect: z.enum(['rate_factor', 'replace_amount', 'coefficient', 'exempt']),
  value: parameter(z.number()).optional(),
  startsOn: isoDate.optional(),
  durationMonths: parameter(z.number().int().positive()).optional(),
  durationPeriods: parameter(z.number().int().positive()).optional(),
  endsOn: isoDate.optional(),
  /** What the user asserts by taking it; the engine never checks eligibility. */
  condition: z.string().optional(),
  source: sourceSchema,
})
export type RegimeModifierTemplate = z.infer<typeof modifierTemplateSchema>

const levyTemplateSchema = z.object({
  when: conditionSchema.optional(),
  name: z.string().min(1),
  kind: z.enum(['social', 'income_tax', 'vat', 'other']),
  validFrom: isoDate,
  validTo: isoDate.optional(),
  source: sourceSchema,
  baseMeasure: z
    .enum([
      'revenue',
      'revenue_incl_vat',
      'expenses',
      'profit',
      'vat_balance',
      'withholdings',
      'input',
      'none',
    ])
    .default('none'),
  baseInputName: z.string().optional(),
  basePeriodRef: z.enum(['current', 'ytd', 'year', 'year-1', 'year-2', 'rolling-12']).optional(),
  baseCoefficient: parameter(z.number().positive()).optional(),
  baseAbatement: parameter(abatementSchema).optional(),
  baseFloor: parameter(z.number().min(0)).optional(),
  baseCap: parameter(z.number().min(0)).optional(),
  baseCredits: creditsSchema.optional(),
  baseScale: z.enum(['none', 'per_month', 'per_period', 'annualized']).optional(),
  amountForm: z.enum(['rate', 'brackets', 'elective_base', 'fixed', 'none']),
  rate: parameter(percent).optional(),
  brackets: bracketsSchema.optional(),
  elective: electiveSchema.optional(),
  fixedAmount: parameter(z.number().min(0)).optional(),
  fixedInputName: z.string().optional(),
  fixedCredit: parameter(z.number().min(0)).optional(),
  creditInputName: z.string().optional(),
  period: parameter(z.enum(['month', 'quarter', 'half', 'year'])),
  due: parameter(dueSchema),
  declarationLagMonths: z.number().int().min(0).optional(),
  firstDueAfterDays: z.number().int().min(0).optional(),
  skipPeriods: skipPeriodsSchema.optional(),
  regularization: z.enum(['none', 'annual_deadzone', 'provisional_then_settled']).optional(),
  regularizationParams: regularizationParamsSchema.optional(),
  deductible: z.boolean().optional(),
  passThrough: z.boolean().optional(),
  /**
   * French: the category the user's payments of this rule are filed under.
   * Applying the model reuses the category of that name when the user already
   * has one and creates it otherwise, then links it: without it nothing would
   * ever tell the engine that a levy was paid, and its reserve would never
   * fall. Two rules of one model never name the same category, because a
   * shared one would let each count the other's payments.
   */
  settlementCategory: z.string().min(1).optional(),
  /** French: shown beside the rule, and the place a limit of the model is said. */
  note: z.string().optional(),
  modifiers: z.array(modifierTemplateSchema).optional(),
})
export type RegimeLevyTemplate = z.infer<typeof levyTemplateSchema>

const thresholdTemplateSchema = z.object({
  when: conditionSchema.optional(),
  label: z.string().min(1),
  measure: z.enum([
    'revenue',
    'revenue_incl_vat',
    'expenses',
    'profit',
    'vat_balance',
    'withholdings',
    'withholding_share',
  ]),
  periodRef: z.enum(['current', 'ytd', 'year', 'year-1', 'year-2', 'rolling-12']).optional(),
  comparison: z.enum(['lte', 'gte']).optional(),
  value: parameter(z.number()),
  /** French: what changes past the value. */
  consequence: z.string().min(1),
  source: sourceSchema,
})
export type RegimeThresholdTemplate = z.infer<typeof thresholdTemplateSchema>

const inputTemplateSchema = z.object({
  when: conditionSchema.optional(),
  name: z.string().min(1),
  validFrom: isoDate,
  value: parameter(z.number()),
  /** French: what the figure is, and where the user reads it. */
  note: z.string().optional(),
})
export type RegimeInputTemplate = z.infer<typeof inputTemplateSchema>

/** What the activity itself is set up with; none of it is ever a switch. */
const activityDefaultsSchema = z.object({
  revenueBasis: z.enum(['cash', 'invoiced']),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  fiscalYearStartDay: z.number().int().min(1).max(31).optional(),
  vatRegistered: parameter(z.boolean()),
  defaultVatRate: parameter(percent).optional(),
  deductibleExpenses: z.enum(['all', 'none']),
  currency: z.string().length(3).optional(),
})
export type RegimeActivityDefaults = z.infer<typeof activityDefaultsSchema>

const modelSchema = z.object({
  id: identifier,
  /** French: it becomes the activity's regime label. */
  name: z.string().min(1),
  description: z.string().min(1),
  when: conditionSchema.optional(),
  source: sourceSchema,
  activity: activityDefaultsSchema,
  levies: z.array(levyTemplateSchema).default([]),
  thresholds: z.array(thresholdTemplateSchema).default([]),
  inputs: z.array(inputTemplateSchema).default([]),
})
export type RegimeModel = z.infer<typeof modelSchema>

export const jurisdictionSchema = z.object({
  id: identifier,
  /** French: it becomes the activity's jurisdiction. */
  name: z.string().min(1),
  description: z.string().min(1),
  questions: z.array(questionSchema).min(1),
  models: z.array(modelSchema).min(1),
})
export type Jurisdiction = z.infer<typeof jurisdictionSchema>

/** True when the value is a table an answer reads, rather than the value itself. */
export function isAnswered<T>(value: Parameter<T>): value is Answered<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'question' in value &&
    'cases' in value &&
    typeof (value as Answered<T>).question === 'string'
  )
}

/**
 * What a parameter is worth given the answers: the value itself, or the case
 * the answer names. Unstated when the question has no answer yet or the answer
 * has no case, which is how a field left out of a branch of the tree stays out.
 */
export function resolveParameter<T>(value: Parameter<T>, answers: Answers): T | undefined {
  if (!isAnswered(value)) return value
  const answer = answers[value.question]
  return answer === undefined ? undefined : value.cases[answer]
}

/** The question a parameter reads, or none when it holds its own value. */
export function questionOf<T>(value: Parameter<T> | undefined): string | undefined {
  return value !== undefined && isAnswered(value) ? value.question : undefined
}

/**
 * Whether the answers let something in. A question left unanswered leaves the
 * condition unsatisfied: nothing enters on an answer that was never given.
 */
export function satisfies(condition: RegimeCondition | undefined, answers: Answers): boolean {
  if (!condition) return true
  for (const [question, accepted] of Object.entries(condition)) {
    const answer = answers[question]
    if (answer === undefined || !accepted.includes(answer)) return false
  }
  return true
}

/**
 * Whether the answers rule something out: an answer already given that the
 * condition does not accept. A question still unanswered rules nothing out,
 * which is what keeps a model a candidate while the tree is being walked.
 */
export function excluded(condition: RegimeCondition | undefined, answers: Answers): boolean {
  if (!condition) return false
  for (const [question, accepted] of Object.entries(condition)) {
    const answer = answers[question]
    if (answer !== undefined && !accepted.includes(answer)) return true
  }
  return false
}

/**
 * Every question a document reads, down to its leaves: through a condition
 * that lets something in, or through a table an answer picks a value from.
 * This is how the engine knows what is still worth asking without knowing
 * what any of it means.
 */
export function questionsIn(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) questionsIn(item, found)
    return found
  }
  if (value === null || typeof value !== 'object') return found
  const node = value as Record<string, unknown>
  if (typeof node.question === 'string' && node.cases !== null && typeof node.cases === 'object')
    found.add(node.question)
  if (node.when !== null && typeof node.when === 'object')
    for (const named of Object.keys(node.when as object)) found.add(named)
  for (const child of Object.values(node)) questionsIn(child, found)
  return found
}
