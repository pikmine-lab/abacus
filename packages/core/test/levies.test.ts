import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { db } from '../src/db/client.ts'
import type { DomainError } from '../src/domain/errors.ts'
import { createAccount } from '../src/services/accounts.ts'
import { createActor } from '../src/services/actors.ts'
import { createActivity, createCategory } from '../src/services/catalog.ts'
import {
  addModifier,
  closeLevy,
  createLevy,
  createThreshold,
  deleteLevy,
  editLevy,
  editModifier,
  editThreshold,
  inputInForce,
  listInputs,
  listLevies,
  listThresholds,
  type NewLevy,
  removeInput,
  removeModifier,
  removeThreshold,
  setInput,
  supersedeLevy,
} from '../src/services/levies.ts'
import { declareMovement } from '../src/services/movements.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

/** The activity every rule below hangs on. */
async function businessActivity(user: string, name = 'Freelance'): Promise<string> {
  const activity = await createActivity(user, { name, kind: 'business', startedOn: '2026-01-01' })
  return activity.id
}

/** The smallest rule that computes: a rate on the period's revenue, due the month after. */
function rateRule(activityId: string, overrides: Partial<NewLevy> = {}): NewLevy {
  return {
    activityId,
    name: 'Cotisations',
    kind: 'social',
    validFrom: '2026-01-01',
    baseMeasure: 'revenue',
    amountForm: 'rate',
    rate: 21.2,
    period: 'month',
    due: { type: 'end_of_next_month' },
    sourceUrl: 'https://example.test/rule',
    verifiedOn: '2026-01-15',
    reviewOn: '2027-01-01',
    ...overrides,
  }
}

const code = (expected: string) => (e: DomainError) => {
  assert.equal(e.code, expected, e.message)
  return true
}

test('a rule is created in each amount form, its parameters normalised by their schema', async () => {
  const user = await seedUser()
  const activity = await businessActivity(user)

  const rate = await createLevy(user, rateRule(activity))
  assert.equal(rate.rate, '21.2000')
  assert.equal(rate.status, 'confirmed')
  assert.deepEqual(rate.due, { type: 'end_of_next_month' })

  const brackets = await createLevy(
    user,
    rateRule(activity, {
      name: 'Impôt',
      kind: 'income_tax',
      baseMeasure: 'profit',
      basePeriodRef: 'ytd',
      amountForm: 'brackets',
      rate: null,
      brackets: {
        mode: 'progressive',
        rows: [
          { upTo: 10000, rate: 10 },
          { upTo: null, rate: 30 },
        ],
      },
      baseAbatement: { rate: 34, minAmount: 305 },
      baseCredits: [{ source: 'withholdings' }],
      fixedCredit: 500,
      period: 'year',
      due: { type: 'fixed_dates', dates: [{ month: 6, day: 30 }] },
    }),
  )
  // Defaults land: the credit's share and period reference, the fixed date's year offset.
  assert.deepEqual(brackets.baseCredits, [{ source: 'withholdings', share: 100, periodRef: 'current' }])
  assert.deepEqual(brackets.due, { type: 'fixed_dates', dates: [{ month: 6, day: 30, yearOffset: 0 }] })
  assert.equal(brackets.fixedCredit, '500.00')

  const elective = await createLevy(
    user,
    rateRule(activity, {
      name: 'Cotisation par tramo',
      baseMeasure: 'profit',
      baseCoefficient: 0.93,
      baseScale: 'per_month',
      amountForm: 'elective_base',
      rate: null,
      elective: {
        rows: [
          { upTo: 670, minBase: 653.59, maxBase: 718.94 },
          { upTo: null, minBase: 718.95, maxBase: 4720.5 },
        ],
        inputName: 'contribution_base',
        rate: 31.5,
      },
      regularization: 'annual_deadzone',
      regularizationParams: { settleMonthOffset: 12 },
      deductible: true,
    }),
  )
  assert.equal(elective.baseCoefficient, '0.9300')
  assert.equal(elective.regularization, 'annual_deadzone')

  const fixed = await createLevy(
    user,
    rateRule(activity, {
      name: 'Taxe locale',
      kind: 'other',
      baseMeasure: 'none',
      amountForm: 'fixed',
      rate: null,
      fixedAmount: 300,
      period: 'year',
      due: { type: 'fixed_dates', dates: [{ month: 12, day: 15 }] },
    }),
  )
  assert.equal(fixed.fixedAmount, '300.00')

  const fromInput = await createLevy(
    user,
    rateRule(activity, {
      name: 'Taxe sur avis',
      kind: 'other',
      baseMeasure: 'none',
      amountForm: 'fixed',
      rate: null,
      fixedInputName: 'local_tax_notice',
      period: 'year',
      due: { type: 'after_period', toDay: 15 },
    }),
  )
  assert.deepEqual(fromInput.due, { type: 'after_period', monthOffset: 1, fromDay: 1, toDay: 15 })

  const none = await createLevy(
    user,
    rateRule(activity, {
      name: 'Déclaration sans paiement',
      kind: 'vat',
      baseMeasure: 'none',
      amountForm: 'none',
      rate: null,
      period: 'quarter',
      due: { type: 'after_period', fromDay: 1, toDay: 25 },
      skipPeriods: { quarter: [4] },
      passThrough: true,
    }),
  )
  assert.deepEqual(none.skipPeriods, { quarter: [4] })

  const listed = await listLevies(user, activity)
  assert.equal(listed.length, 6)
  assert.ok(listed.every((levy) => Array.isArray(levy.modifiers)))
})

test('a rule refuses what would not compute, and says which field to fix', async () => {
  const user = await seedUser()
  const activity = await businessActivity(user)
  const personal = await createActivity(user, { name: 'Perso' })
  const other = await businessActivity(user, 'Autre')

  await assert.rejects(createLevy(user, rateRule(personal.id)), code('activity_not_business'))
  await assert.rejects(createLevy(user, rateRule(activity, { rate: null })), code('levy_form_needs_param'))
  await assert.rejects(
    createLevy(user, rateRule(activity, { amountForm: 'brackets', rate: null })),
    code('levy_form_needs_param'),
  )
  await assert.rejects(
    createLevy(user, rateRule(activity, { amountForm: 'fixed', rate: null })),
    code('levy_form_needs_param'),
  )
  await assert.rejects(
    createLevy(user, rateRule(activity, { fixedAmount: 12 })),
    code('levy_form_param_unexpected'),
  )
  await assert.rejects(createLevy(user, rateRule(activity, { rate: 140 })), code('levy_value_invalid'))
  await assert.rejects(createLevy(user, rateRule(activity, { validTo: '2025-12-31' })), code('levy_validity'))
  await assert.rejects(
    createLevy(
      user,
      rateRule(activity, {
        amountForm: 'brackets',
        rate: null,
        brackets: { mode: 'progressive', rows: [{ upTo: 100, rate: 150 }] },
      }),
    ),
    (e: DomainError) => e.code === 'levy_params_invalid' && /brackets\.rows\.0\.rate/.test(e.message),
  )
  await assert.rejects(
    createLevy(user, rateRule(activity, { due: { type: 'after_period' } })),
    (e: DomainError) => e.code === 'levy_params_invalid' && /due/.test(e.message),
  )
  await assert.rejects(
    createLevy(user, rateRule(activity, { baseMeasure: 'paid' })),
    code('levy_base_needs_levy'),
  )
  await assert.rejects(
    createLevy(user, rateRule(activity, { baseMeasure: 'input' })),
    code('levy_base_needs_input'),
  )
  await assert.rejects(
    createLevy(user, rateRule(activity, { baseInputName: 'x' })),
    code('levy_base_input_unexpected'),
  )

  // A rule reads the rules of its own activity, never another's.
  const elsewhere = await createLevy(user, rateRule(other, { name: 'Acomptes' }))
  await assert.rejects(
    createLevy(user, rateRule(activity, { baseMeasure: 'paid', baseLevyId: elsewhere.id })),
    code('base_levy_other_activity'),
  )
  await assert.rejects(
    createLevy(user, rateRule(activity, { baseCredits: [{ source: 'paid', levyId: elsewhere.id }] })),
    code('base_levy_other_activity'),
  )
  await assert.rejects(
    createLevy(user, rateRule(activity, { baseCredits: [{ source: 'paid' }] })),
    code('levy_params_invalid'),
  )
  const here = await createLevy(user, rateRule(activity, { name: 'Acomptes' }))
  const annual = await createLevy(
    user,
    rateRule(activity, { name: 'Annuel', baseMeasure: 'amount', baseLevyId: here.id, period: 'year' }),
  )
  assert.equal(annual.baseLevyId, here.id)
  await assert.rejects(editLevy(user, annual.id, { baseLevyId: annual.id }), code('base_levy_self'))

  const category = await createCategory(user, 'Cotisations')
  const stranger = await seedUser('user-2')
  const theirs = await createCategory(stranger, 'Leur catégorie')
  await assert.rejects(
    createLevy(user, rateRule(activity, { settlementCategoryId: theirs.id })),
    code('category_not_found'),
  )
  const settled = await createLevy(
    user,
    rateRule(activity, { name: 'Réglée', settlementCategoryId: category.id }),
  )
  assert.equal(settled.settlementCategoryId, category.id)
})

test('a settlement category answers for one rule at a time, over the validities that overlap', async () => {
  const user = await seedUser()
  const activity = await businessActivity(user)
  const other = await businessActivity(user, 'Autre')
  const category = await createCategory(user, 'Cotisations')
  const held = await createLevy(user, rateRule(activity, { settlementCategoryId: category.id }))

  // Both live at once: each would read the other's expenses as its payments.
  await assert.rejects(
    createLevy(user, rateRule(activity, { name: 'Doublon', settlementCategoryId: category.id })),
    code('levy_settlement_category_taken'),
  )
  await assert.rejects(
    createLevy(
      user,
      rateRule(activity, { name: 'Plus tard', validFrom: '2027-01-01', settlementCategoryId: category.id }),
    ),
    code('levy_settlement_category_taken'),
  )
  // Another activity's rules never see these expenses.
  await createLevy(user, rateRule(other, { name: 'Ailleurs', settlementCategoryId: category.id }))
  // A rule may keep the category it already holds when it is corrected.
  assert.equal(
    (await editLevy(user, held.id, { rate: 22, settlementCategoryId: category.id })).settlementCategoryId,
    category.id,
  )

  // Once the holder is closed, the periods after it are free to file there.
  await closeLevy(user, held.id, '2026-12-31')
  const successor = await createLevy(
    user,
    rateRule(activity, { name: 'Suite', validFrom: '2027-01-01', settlementCategoryId: category.id }),
  )
  assert.equal(successor.settlementCategoryId, category.id)
  // And a rule that ends before another begins is what supersede writes.
  const { created } = await supersedeLevy(user, successor.id, { validFrom: '2028-01-01', rate: 23 })
  assert.equal(created.settlementCategoryId, category.id)
  // Reopening the closed one would put it back on top of its successor.
  await assert.rejects(editLevy(user, held.id, { validTo: null }), code('levy_settlement_category_taken'))
})

test('a correction rewrites the row, and dropping a form takes its parameters with it', async () => {
  const user = await seedUser()
  const activity = await businessActivity(user)
  const levy = await createLevy(
    user,
    rateRule(activity, {
      amountForm: 'brackets',
      rate: null,
      brackets: { mode: 'step', rows: [{ upTo: null, amount: 100 }] },
    }),
  )

  const corrected = await editLevy(user, levy.id, {
    amountForm: 'rate',
    rate: 25.6,
    name: 'Cotisations sociales',
  })
  assert.equal(corrected.amountForm, 'rate')
  assert.equal(corrected.rate, '25.6000')
  assert.equal(corrected.brackets, null)
  assert.equal(corrected.name, 'Cotisations sociales')
  // What the patch does not mention stays.
  assert.equal(corrected.sourceUrl, 'https://example.test/rule')
  assert.equal(corrected.validFrom, '2026-01-01')
})

test('a rate that changes supersedes: the old row closes the day before, the new one carries on', async () => {
  const user = await seedUser()
  const activity = await businessActivity(user)
  const levy = await createLevy(user, rateRule(activity))
  await addModifier(user, levy.id, {
    label: 'Taux réduit de début',
    effect: 'rate_factor',
    value: 0.75,
    durationMonths: 12,
    condition: 'first year of activity',
  })
  await addModifier(user, levy.id, { label: 'Fini', effect: 'exempt', endsOn: '2026-06-30' })

  const { closed, created } = await supersedeLevy(user, levy.id, {
    validFrom: '2027-01-01',
    rate: 22.5,
    sourceUrl: 'https://example.test/rule-2027',
    verifiedOn: '2027-01-05',
  })
  assert.equal(closed.id, levy.id)
  assert.equal(closed.validTo, '2026-12-31')
  assert.equal(closed.rate, '21.2000')
  assert.equal(created.validFrom, '2027-01-01')
  assert.equal(created.validTo, null)
  assert.equal(created.rate, '22.5000')
  assert.equal(created.name, levy.name)
  assert.equal(created.sourceUrl, 'https://example.test/rule-2027')

  const listed = await listLevies(user, activity)
  const successor = listed.find((l) => l.id === created.id)!
  // The running modifier follows the rule; the one already over does not.
  assert.deepEqual(
    successor.modifiers.map((m) => m.label),
    ['Taux réduit de début'],
  )
  assert.equal(listed.find((l) => l.id === levy.id)!.modifiers.length, 2)

  // In force at a date: one row, never two.
  assert.deepEqual(
    (await listLevies(user, activity, { at: '2026-07-01' })).map((l) => l.id),
    [levy.id],
  )
  assert.deepEqual(
    (await listLevies(user, activity, { at: '2027-03-01' })).map((l) => l.id),
    [created.id],
  )

  await assert.rejects(
    supersedeLevy(user, created.id, { validFrom: '2027-01-01', rate: 23 }),
    code('supersede_before_start'),
  )
  await assert.rejects(closeLevy(user, created.id, '2026-12-01'), code('levy_validity'))
  const ended = await closeLevy(user, created.id, '2027-12-31')
  assert.equal(ended.validTo, '2027-12-31')
})

test('a rule settled by an expense in its category is history: it closes, it is not deleted', async () => {
  const user = await seedUser()
  const activity = await businessActivity(user)
  const category = await createCategory(user, 'Cotisations')
  const levy = await createLevy(user, rateRule(activity, { settlementCategoryId: category.id }))
  const account = await createAccount({ userId: user, name: 'Pro', behavior: 'payment' })
  const office = await createActor(user, { name: 'Tax office' })

  // A settlement before the rule's validity does not count against it. It has
  // a category of its own: a live rule already holds the first one.
  const other = await createCategory(user, 'Formation')
  await declareMovement(user, {
    happenedOn: '2025-12-20',
    amount: 100,
    sourceAccountId: account.id,
    targetActorId: office.id,
    categoryId: other.id,
    activityId: activity,
  })
  const fresh = await createLevy(
    user,
    rateRule(activity, { name: 'Jamais réglée', settlementCategoryId: other.id }),
  )
  await deleteLevy(user, fresh.id)

  await declareMovement(user, {
    happenedOn: '2026-02-28',
    amount: 250,
    sourceAccountId: account.id,
    targetActorId: office.id,
    categoryId: category.id,
    activityId: activity,
  })
  await assert.rejects(deleteLevy(user, levy.id), code('levy_has_settlements'))

  // A rule another one reads stays too.
  const base = await createLevy(user, rateRule(activity, { name: 'Acomptes' }))
  const reader = await createLevy(
    user,
    rateRule(activity, { name: 'Annuel', baseCredits: [{ source: 'paid', levyId: base.id }] }),
  )
  await assert.rejects(deleteLevy(user, base.id), code('levy_referenced'))
  await deleteLevy(user, reader.id)
  await addModifier(user, base.id, { label: 'Exo', effect: 'exempt' })
  await deleteLevy(user, base.id)
  assert.equal((await listLevies(user, activity)).length, 1)
  const [{ count }] = await db()<{ count: string }[]>`select count(*) from levy_modifier`
  assert.equal(Number(count), 0)
})

test('a modifier carries one duration and a value unless it exempts', async () => {
  const user = await seedUser()
  const activity = await businessActivity(user)
  const levy = await createLevy(user, rateRule(activity))

  await assert.rejects(
    addModifier(user, levy.id, { label: 'x', effect: 'rate_factor' }),
    code('modifier_needs_value'),
  )
  await assert.rejects(
    addModifier(user, levy.id, { label: 'x', effect: 'coefficient', value: 0 }),
    code('modifier_value_invalid'),
  )
  await assert.rejects(
    addModifier(user, levy.id, {
      label: 'x',
      effect: 'replace_amount',
      value: 80,
      durationMonths: 12,
      endsOn: '2026-12-31',
    }),
    code('modifier_single_duration'),
  )
  const exempt = await addModifier(user, levy.id, { label: 'Année de création', effect: 'exempt', value: 3 })
  assert.equal(exempt.value, null)

  const flat = await addModifier(user, levy.id, {
    label: 'Montant réduit',
    effect: 'replace_amount',
    value: 80,
    durationMonths: 12,
    status: 'unconfirmed',
  })
  assert.equal(flat.durationMonths, 12)
  // Stating another duration replaces the one held, rather than colliding with it.
  const extended = await editModifier(user, flat.id, { durationPeriods: 24 })
  assert.equal(extended.durationMonths, null)
  assert.equal(extended.durationPeriods, 24)
  assert.equal(extended.status, 'unconfirmed')

  await removeModifier(user, flat.id)
  assert.deepEqual(
    (await listLevies(user, activity))[0]!.modifiers.map((m) => m.label),
    ['Année de création'],
  )
  await assert.rejects(removeModifier(user, flat.id), code('modifier_not_found'))
})

test('a stated figure is dated, replaced on the same day, and read at a date', async () => {
  const user = await seedUser()
  const activity = await businessActivity(user)
  const personal = await createActivity(user, { name: 'Perso' })

  await assert.rejects(
    setInput(user, personal.id, { name: 'contribution_base', validFrom: '2026-01-01', value: 950 }),
    code('activity_not_business'),
  )
  await assert.rejects(
    setInput(user, activity, { name: ' ', validFrom: '2026-01-01', value: 950 }),
    code('input_value_invalid'),
  )
  await setInput(user, activity, { name: 'contribution_base', validFrom: '2026-01-01', value: 950 })
  await setInput(user, activity, {
    name: 'contribution_base',
    validFrom: '2026-07-01',
    value: 1000,
    note: 'raised',
  })
  const replaced = await setInput(user, activity, {
    name: 'contribution_base',
    validFrom: '2026-07-01',
    value: 1050,
  })
  assert.equal(replaced.value, '1050.0000')
  assert.equal(replaced.note, null)

  assert.equal((await inputInForce(user, activity, 'contribution_base', '2026-03-15'))?.value, '950.0000')
  assert.equal((await inputInForce(user, activity, 'contribution_base', '2026-07-01'))?.value, '1050.0000')
  assert.equal(await inputInForce(user, activity, 'contribution_base', '2025-12-31'), null)
  assert.equal(await inputInForce(user, activity, 'other', '2026-12-31'), null)

  const inputs = await listInputs(user, activity)
  assert.deepEqual(
    inputs.map((i) => i.validFrom),
    ['2026-07-01', '2026-01-01'],
  )
  await removeInput(user, inputs[0]!.id)
  assert.equal((await listInputs(user, activity)).length, 1)
  await assert.rejects(removeInput(user, inputs[0]!.id), code('input_not_found'))
})

test('a threshold names a measure, a value and what changes past it', async () => {
  const user = await seedUser()
  const activity = await businessActivity(user)

  await assert.rejects(
    createThreshold(user, activity, {
      label: 'Franchise',
      measure: 'revenue',
      value: 37500,
      consequence: ' ',
    }),
    code('threshold_value_invalid'),
  )
  const threshold = await createThreshold(user, activity, {
    label: 'Franchise',
    measure: 'revenue',
    value: 37500,
    consequence: 'VAT becomes due from the first day of overshoot',
    sourceUrl: 'https://example.test/vat',
    verifiedOn: '2026-01-10',
  })
  assert.equal(threshold.periodRef, 'ytd')
  assert.equal(threshold.comparison, 'lte')

  const edited = await editThreshold(user, threshold.id, { periodRef: 'year-1', value: 41250 })
  assert.equal(edited.periodRef, 'year-1')
  assert.equal(edited.value, '41250.00')
  assert.equal(edited.label, 'Franchise')

  assert.equal((await listThresholds(user, activity)).length, 1)
  await removeThreshold(user, threshold.id)
  assert.equal((await listThresholds(user, activity)).length, 0)
  await assert.rejects(removeThreshold(user, threshold.id), code('threshold_not_found'))
})
