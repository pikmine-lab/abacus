import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { DomainError } from '../src/domain/errors.ts'
import type { Answers } from '../src/domain/regime.ts'
import { createActivity, editActivity, listActivities } from '../src/services/catalog.ts'
import { editLevy, listInputs, listLevies, listThresholds } from '../src/services/levies.ts'
import { applyRegime, listJurisdictions, previewRegime, questionnaire } from '../src/services/regimes.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

const code = (expected: string) => (e: DomainError) => {
  assert.equal(e.code, expected, e.message)
  return true
}

/** Walks the tree, always taking an answer that keeps the wanted model standing. */
function answersFor(jurisdictionId: string, modelId: string): Answers {
  let answers: Answers = {}
  for (let guard = 0; guard < 20; guard++) {
    const step = questionnaire(jurisdictionId, answers)
    if (step.done) return answers
    const question = step.question!
    const option = question.options.find((candidate) =>
      questionnaire(jurisdictionId, { ...answers, [question.id]: candidate.value }).models.some(
        (model) => model.id === modelId,
      ),
    )
    assert.ok(option, `no answer to "${question.id}" keeps "${modelId}" standing`)
    answers = { ...answers, [question.id]: option.value }
  }
  throw new Error(`The questionnaire of "${jurisdictionId}" never ends`)
}

const FR_BNC: Answers = {
  activity_nature: 'liberal_bnc',
  income_tax: 'flat',
  declaration_period: 'quarter',
  vat: 'franchise',
  acre: 'no',
}

test('every model of the catalog loads, resolves and writes rules the domain accepts', async () => {
  const user = await seedUser()
  const jurisdictions = listJurisdictions()
  assert.deepEqual(
    jurisdictions.map((j) => j.id),
    ['fr', 'es'],
  )

  for (const jurisdiction of jurisdictions) {
    assert.ok(jurisdiction.models.length > 0, `${jurisdiction.id} ships no model`)
    for (const model of jurisdiction.models) {
      const answers = answersFor(jurisdiction.id, model.id)
      const preview = previewRegime(model.id, answers)
      assert.ok(preview.levies.length > 0, `${model.id} writes no rule`)
      for (const { levy } of preview.levies) {
        // A rule is worth its source: the catalog never ships one without the
        // text it comes from and the day someone read it.
        assert.ok(levy.sourceUrl, `${model.id}: rule "${levy.name}" has no source`)
        assert.ok(levy.verifiedOn, `${model.id}: rule "${levy.name}" was never checked`)
        assert.ok(levy.status, `${model.id}: rule "${levy.name}" has no status`)
      }
      // The strongest check the catalog can get: every rule goes through the
      // same validation a hand-typed one does.
      const applied = await applyRegime(user, { name: model.id, modelId: model.id, answers })
      assert.equal(applied.levies.length, preview.levies.length)
      assert.equal(applied.thresholds.length, preview.thresholds.length)
      assert.equal(applied.inputs.length, preview.inputs.length)
    }
  }
})

test('the French tree narrows to one model and asks only what the answers reach', () => {
  const opening = questionnaire('fr')
  assert.equal(opening.question?.id, 'activity_nature')
  assert.equal(opening.models.length, 2)
  assert.equal(opening.done, false)

  // The nature of the activity fills in rates: it narrows nothing.
  const nature = questionnaire('fr', { activity_nature: 'liberal_bnc' })
  assert.equal(nature.models.length, 2)
  assert.equal(nature.question?.id, 'income_tax')

  // The income tax option is the one that chooses between the two models.
  const chosen = questionnaire('fr', { activity_nature: 'liberal_bnc', income_tax: 'flat' })
  assert.deepEqual(
    chosen.models.map((m) => m.id),
    ['fr-micro-flat'],
  )
  assert.equal(chosen.done, false, 'parameters the remaining model reads are still missing')

  // A question conditioned on an answer is asked only under that answer.
  const franchise = questionnaire('fr', { ...FR_BNC, vat: 'franchise' })
  assert.equal(franchise.question, null, 'the VAT rate is never asked under the franchise')
  const charged = questionnaire('fr', { ...FR_BNC, vat: 'charged' })
  assert.equal(charged.question?.id, 'vat_rate')
  assert.equal(charged.done, false)

  assert.equal(questionnaire('fr', FR_BNC).done, true)
  assert.equal(questionnaire('fr', FR_BNC).question, null)
})

test('the Spanish tree asks about the foral year only under the foral administration', () => {
  const opening = questionnaire('es')
  assert.equal(opening.question?.id, 'tax_administration')
  assert.equal(opening.models.length, 3)

  const common = questionnaire('es', { tax_administration: 'aeat' })
  assert.deepEqual(
    common.models.map((m) => m.id),
    ['es-aeat'],
  )
  assert.notEqual(common.question?.id, 'years_active')

  const foral = questionnaire('es', { tax_administration: 'bizkaia' })
  assert.equal(foral.question?.id, 'years_active')
  assert.equal(foral.models.length, 2)

  const started = questionnaire('es', { tax_administration: 'bizkaia', years_active: 'first_two' })
  assert.deepEqual(
    started.models.map((m) => m.id),
    ['es-bizkaia-start'],
  )
})

test('a preview shows the figures the answers picked, with their source and their status', () => {
  const preview = previewRegime('fr-micro-flat', FR_BNC)
  assert.equal(preview.activity.jurisdiction, 'France')
  assert.equal(preview.activity.regimeLabel, 'Micro-entreprise, versement libératoire')
  assert.equal(preview.activity.revenueBasis, 'cash')
  assert.equal(preview.activity.deductibleExpenses, 'none')
  assert.equal(preview.activity.vatRegistered, false)
  assert.equal(preview.activity.defaultVatRate, undefined, 'no VAT rate under the franchise')

  const rules = new Map(preview.levies.map((entry) => [entry.levy.name, entry]))
  assert.equal(rules.get('Cotisations sociales')?.levy.rate, 25.6)
  assert.equal(rules.get("Versement libératoire de l'impôt sur le revenu")?.levy.rate, 2.2)
  assert.equal(rules.get('Contribution à la formation professionnelle')?.levy.rate, 0.2)
  assert.equal(rules.get('Cotisations sociales')?.levy.period, 'quarter')
  assert.equal(
    rules.get('Cotisations sociales')?.levy.sourceUrl,
    'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000052218738',
  )
  assert.equal(rules.get('Cotisations sociales')?.levy.status, 'confirmed')
  // No text fixes what a commune votes: the rule says so rather than inventing.
  assert.equal(rules.get('Cotisation foncière des entreprises')?.levy.status, 'unconfirmed')
  assert.equal(rules.has('TVA'), false, 'the VAT rule stays out under the franchise')

  const thresholds = new Map(preview.thresholds.map((threshold) => [threshold.label, threshold]))
  assert.equal(thresholds.get('Plafond du régime micro')?.value, 83600)
  assert.equal(
    thresholds.get("Franchise en base de TVA, chiffre d'affaires de l'année précédente")?.value,
    37500,
  )

  // The same model, another nature: the tables answer differently.
  const sale = previewRegime('fr-micro-flat', { ...FR_BNC, activity_nature: 'sale' })
  const social = sale.levies.find((entry) => entry.levy.name === 'Cotisations sociales')
  assert.equal(social?.levy.rate, 12.3)
  assert.equal(sale.thresholds.find((t) => t.label === 'Plafond du régime micro')?.value, 203100)
})

test('an answer lets an optional block of rules in, or leaves it out', () => {
  const without = previewRegime('fr-micro-flat', FR_BNC)
  const social = without.levies.find((entry) => entry.levy.name === 'Cotisations sociales')!
  assert.equal(social.modifiers.length, 0)

  const with_ = previewRegime('fr-micro-flat', { ...FR_BNC, acre: 'yes' })
  const reduced = with_.levies.find((entry) => entry.levy.name === 'Cotisations sociales')!
  assert.equal(reduced.modifiers.length, 1)
  assert.equal(reduced.modifiers[0]?.effect, 'rate_factor')
  assert.equal(reduced.modifiers[0]?.value, 0.75)
  // Quarterly filing: the reduction lasts the quarter of creation and the three after.
  assert.equal(reduced.modifiers[0]?.durationPeriods, 4)
  assert.equal(
    previewRegime('fr-micro-flat', { ...FR_BNC, acre: 'yes', declaration_period: 'month' }).levies.find(
      (entry) => entry.levy.name === 'Cotisations sociales',
    )?.modifiers[0]?.durationPeriods,
    12,
  )

  // Charging VAT brings a rule in and changes what the activity is created with.
  const charged = previewRegime('fr-micro-flat', { ...FR_BNC, vat: 'charged', vat_rate: 'standard' })
  assert.equal(charged.activity.vatRegistered, true)
  assert.equal(charged.activity.defaultVatRate, 20)
  assert.ok(charged.levies.some((entry) => entry.levy.name === 'TVA'))
  assert.equal(
    charged.thresholds.some((t) => t.label.startsWith('Franchise en base')),
    false,
    'the franchise thresholds go once the VAT is charged',
  )
})

test('a Spanish preview carries the elective table, and a value no text confirms says so', () => {
  const answers = answersFor('es', 'es-bizkaia-start')
  const preview = previewRegime('es-bizkaia-start', { ...answers, tarifa_plana: 'yes' })
  assert.equal(preview.activity.jurisdiction, 'Espagne')
  assert.equal(preview.activity.revenueBasis, 'invoiced')
  assert.equal(preview.activity.deductibleExpenses, 'all')
  assert.equal(preview.activity.defaultVatRate, 21)

  const reta = preview.levies.find((entry) => entry.levy.name === 'Cotisation RETA')!
  assert.equal(reta.levy.amountForm, 'elective_base')
  const elective = reta.levy.elective as { rows: unknown[]; rate: number; inputName: string }
  assert.equal(elective.rows.length, 15)
  assert.equal(elective.rate, 31.5)
  assert.equal(reta.levy.regularization, 'annual_deadzone')
  // A lapsed text the administration keeps applying is not a confirmed one.
  assert.equal(reta.modifiers[0]?.status, 'extended_by_default')
  assert.equal(reta.modifiers[0]?.value, 80)

  const instalment = preview.levies.find((entry) => entry.levy.name.startsWith('Paiement fractionné'))!
  assert.equal(instalment.levy.rate, 20)
  assert.equal(instalment.levy.basePeriodRef, 'current')

  // The third year reads another window entirely, which is why it is another model.
  const later = previewRegime('es-bizkaia-established', { ...answers, years_active: 'later' })
  const forfait = later.levies.find((entry) => entry.levy.name.startsWith('Paiement fractionné'))!
  assert.equal(forfait.levy.rate, 5)
  assert.equal(forfait.levy.basePeriodRef, 'year-2')
  assert.equal(preview.inputs.find((input) => input.name === 'reta_base')?.value, 950.98)
})

test('applying a model writes the activity, its rules and its figures in one gesture', async () => {
  const user = await seedUser()
  const applied = await applyRegime(user, {
    name: 'Indépendant',
    modelId: 'fr-micro-flat',
    answers: { ...FR_BNC, acre: 'yes' },
    startedOn: '2026-07-01',
  })

  assert.equal(applied.activity.kind, 'business')
  assert.equal(applied.activity.jurisdiction, 'France')
  assert.equal(applied.activity.regimeLabel, 'Micro-entreprise, versement libératoire')
  assert.equal(applied.activity.revenueBasis, 'cash')
  assert.equal(applied.activity.startedOn, '2026-07-01')
  assert.equal(applied.activity.vatRegistered, false)

  const levies = await listLevies(user, applied.activity.id)
  const social = levies.find((levy) => levy.name === 'Cotisations sociales')!
  assert.equal(social.rate, '25.6000')
  assert.equal(social.status, 'confirmed')
  assert.equal(social.verifiedOn, '2026-09-04')
  assert.equal(social.modifiers.length, 1)
  assert.equal(social.modifiers[0]?.effect, 'rate_factor')

  const thresholds = await listThresholds(user, applied.activity.id)
  assert.ok(thresholds.some((threshold) => threshold.label === 'Plafond du régime micro'))
  const inputs = await listInputs(user, applied.activity.id)
  assert.ok(inputs.some((input) => input.name === 'cfe_notice_amount'))
})

test('what an activity took from a model is its own: neither side reaches the other', async () => {
  const user = await seedUser()
  const first = await applyRegime(user, { name: 'Première', modelId: 'fr-micro-flat', answers: FR_BNC })
  const social = (await listLevies(user, first.activity.id)).find(
    (levy) => levy.name === 'Cotisations sociales',
  )!
  await editLevy(user, social.id, { rate: 11, note: 'Corrigé à la main' })

  // The catalog did not move: a correction on a copy stays on that copy.
  assert.equal(
    previewRegime('fr-micro-flat', FR_BNC).levies.find((entry) => entry.levy.name === 'Cotisations sociales')
      ?.levy.rate,
    25.6,
  )
  const second = await applyRegime(user, { name: 'Seconde', modelId: 'fr-micro-flat', answers: FR_BNC })
  const other = (await listLevies(user, second.activity.id)).find(
    (levy) => levy.name === 'Cotisations sociales',
  )!
  assert.equal(other.rate, '25.6000')
  assert.equal(other.note, social.note, 'the second activity carries the model note, not the correction')

  // And a preview is a copy too: what a caller does to it reaches nothing.
  const preview = previewRegime('fr-micro-flat', FR_BNC)
  preview.levies[0]!.levy.rate = 99
  assert.notEqual(previewRegime('fr-micro-flat', FR_BNC).levies[0]?.levy.rate, 99)
})

test('an activity says where it is run, and a calculation never reads it', async () => {
  const user = await seedUser()
  const activity = await createActivity(user, {
    name: 'Conseil',
    kind: 'business',
    jurisdiction: 'Portugal',
  })
  assert.equal(activity.jurisdiction, 'Portugal')

  const moved = await editActivity(user, activity.id, { jurisdiction: 'Espagne' })
  assert.equal(moved.jurisdiction, 'Espagne')
  const cleared = await editActivity(user, activity.id, { jurisdiction: null })
  assert.equal(cleared.jurisdiction, null)
  assert.equal((await listActivities(user)).find((a) => a.id === activity.id)?.jurisdiction, null)
})

test('the catalog refuses what it cannot answer', async () => {
  const user = await seedUser()
  assert.throws(() => questionnaire('de'), code('jurisdiction_not_found'))
  assert.throws(() => previewRegime('fr-micro-somewhere'), code('regime_model_not_found'))
  assert.throws(() => questionnaire('fr', { activity_nature: 'astronaute' }), code('regime_answer_unknown'))
  assert.throws(() => questionnaire('fr', { profession: 'liberal_bnc' }), code('regime_answer_unknown'))
  // A model whose parameters have no answer would write a rule that computes
  // nothing: it is refused before anything is built.
  assert.throws(() => previewRegime('fr-micro-flat'), code('regime_answers_incomplete'))
  assert.throws(
    () => previewRegime('fr-micro-flat', { ...FR_BNC, income_tax: 'scale' }),
    code('regime_model_excluded'),
  )
  await assert.rejects(
    applyRegime(user, { name: 'Sans réponses', modelId: 'es-aeat', answers: {} }),
    code('regime_answers_incomplete'),
  )
  await applyRegime(user, { name: 'Doublon', modelId: 'fr-micro-flat', answers: FR_BNC })
  await assert.rejects(
    applyRegime(user, { name: 'Doublon', modelId: 'fr-micro-flat', answers: FR_BNC }),
    code('activity_exists'),
  )
})
