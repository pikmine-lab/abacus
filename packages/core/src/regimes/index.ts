import { type Jurisdiction, jurisdictionSchema, questionsIn } from '../domain/regime.ts'
import { ES } from './es.ts'
import { FR } from './fr.ts'

/**
 * The catalog of regime models shipped with the repository (issue #90).
 *
 * The models live in the data files beside this one and nowhere else. They are
 * public reference data, like a quoted instrument: nobody owns them, so no
 * table holds them, no migration seeds them, and updating a rate is a diff a
 * reviewer reads in the pull request that changes it. Nothing joins a user's
 * row to one either, since applying a model copies it.
 *
 * Adding a model to a jurisdiction is a data edit; adding a jurisdiction is
 * that plus one line in FILES, which is the whole of the code a new country
 * costs.
 *
 * Everything is checked once, on the first read: the shapes by the schemas of
 * domain/regime.ts, then the references between them, because a model naming
 * a question that does not exist would only fail in front of a user, halfway
 * through a questionnaire.
 */

const FILES: unknown[] = [FR, ES]

let loaded: Jurisdiction[] | undefined

export function catalog(): Jurisdiction[] {
  if (!loaded) {
    const jurisdictions = FILES.map(load)
    unique(
      jurisdictions.map((j) => j.id),
      'jurisdiction id',
    )
    // A model id names its model everywhere, so a caller says which regime it
    // wants with one word rather than a pair.
    unique(
      jurisdictions.flatMap((j) => j.models.map((m) => m.id)),
      'model id',
    )
    loaded = jurisdictions
  }
  return loaded
}

function load(file: unknown): Jurisdiction {
  const parsed = jurisdictionSchema.safeParse(file)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid regime jurisdiction: ${issues}`)
  }
  return check(parsed.data)
}

function unique(values: string[], what: string): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${what} "${value}"`)
    seen.add(value)
  }
}

/**
 * Every question a document names must be declared, with the answer it names,
 * and a question may only be conditioned on questions asked before it: a tree
 * whose branches point backwards would never be walked to its end.
 */
function check(jurisdiction: Jurisdiction): Jurisdiction {
  const where = `Jurisdiction "${jurisdiction.id}"`
  unique(
    jurisdiction.questions.map((q) => q.id),
    `${where} question id`,
  )
  unique(
    jurisdiction.models.map((m) => m.id),
    `${where} model id`,
  )
  const options = new Map(jurisdiction.questions.map((q) => [q.id, new Set(q.options.map((o) => o.value))]))
  for (const question of jurisdiction.questions) {
    unique(
      question.options.map((o) => o.value),
      `${where} option of "${question.id}"`,
    )
  }
  const asked = new Set<string>()
  for (const question of jurisdiction.questions) {
    for (const [named, values] of Object.entries(question.when ?? {})) {
      if (!asked.has(named))
        throw new Error(`${where}: question "${question.id}" waits on "${named}", asked later or not at all`)
      checkValues(where, named, values, options)
    }
    asked.add(question.id)
  }
  for (const model of jurisdiction.models) {
    for (const named of questionsIn(model)) {
      if (!options.has(named))
        throw new Error(`${where}: model "${model.id}" reads unknown question "${named}"`)
    }
    checkCases(`${where}, model "${model.id}"`, model, options)
  }
  return jurisdiction
}

function checkValues(
  where: string,
  question: string,
  values: string[],
  options: Map<string, Set<string>>,
): void {
  const declared = options.get(question)
  if (!declared) throw new Error(`${where}: unknown question "${question}"`)
  for (const value of values)
    if (!declared.has(value)) throw new Error(`${where}: question "${question}" has no answer "${value}"`)
}

/** Every condition and every answered table of a document, down to the leaves. */
function checkCases(where: string, value: unknown, options: Map<string, Set<string>>): void {
  if (Array.isArray(value)) {
    for (const item of value) checkCases(where, item, options)
    return
  }
  if (value === null || typeof value !== 'object') return
  const node = value as Record<string, unknown>
  if (typeof node.question === 'string' && node.cases !== null && typeof node.cases === 'object')
    checkValues(where, node.question, Object.keys(node.cases as object), options)
  if (node.when !== null && typeof node.when === 'object')
    for (const [named, values] of Object.entries(node.when as Record<string, string[]>))
      checkValues(where, named, values, options)
  for (const child of Object.values(node)) checkCases(where, child, options)
}
