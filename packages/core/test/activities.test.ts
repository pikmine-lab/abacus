import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { db } from '../src/db/client.ts'
import type { DomainError } from '../src/domain/errors.ts'
import { createAccount, editAccount } from '../src/services/accounts.ts'
import { createActor, editActor, listActors } from '../src/services/actors.ts'
import {
  closeActivity,
  createActivity,
  createCategory,
  editActivity,
  listActivities,
  listCategoryExceptions,
  reopenActivity,
  setActivityCategoryExceptions,
} from '../src/services/catalog.ts'
import { seedUser, setupDb, teardownDb, truncateAll } from './helpers.ts'

before(setupDb)
beforeEach(truncateAll)
after(teardownDb)

/**
 * The smallest row the schema accepts, written in SQL because a levy is
 * declared by the next slice: what this file needs of it is only that it
 * exists, which is what fixes the activity's regime.
 */
async function seedLevy(userId: string, activityId: string): Promise<void> {
  await db()`
    insert into levy (user_id, activity_id, name, kind, valid_from, base_measure, amount_form, period, due)
    values (${userId}, ${activityId}, 'Contribution', 'social', '2026-01-01', 'revenue', 'none', 'year',
            ${'{"type":"end_of_next_month"}'}::jsonb)
  `
}

test('an activity is declared with its regime, and defaults to a personal sphere', async () => {
  const user = await seedUser()

  const business = await createActivity(user, {
    name: 'Conseil',
    kind: 'business',
    startedOn: '2026-01-15',
    fiscalYearStartMonth: 4,
    fiscalYearStartDay: 6,
    revenueBasis: 'invoiced',
    vatRegistered: true,
    defaultVatRate: 21,
    deductibleExpenses: 'all',
    regimeLabel: 'Régime de contrôle',
    currency: 'GBP',
  })
  assert.equal(business.kind, 'business')
  assert.equal(business.startedOn, '2026-01-15')
  assert.equal(business.fiscalYearStartMonth, 4)
  assert.equal(business.fiscalYearStartDay, 6)
  assert.equal(business.revenueBasis, 'invoiced')
  assert.equal(business.vatRegistered, true)
  assert.equal(Number(business.defaultVatRate), 21)
  assert.equal(business.deductibleExpenses, 'all')
  assert.equal(business.regimeLabel, 'Régime de contrôle')
  assert.equal(business.currency, 'GBP')

  // What an activity was before it could be a business: a name and nothing else.
  const personal = await createActivity(user, { name: 'Location' })
  assert.equal(personal.kind, 'personal')
  assert.equal(personal.revenueBasis, 'cash')
  assert.equal(personal.vatRegistered, false)
  assert.equal(personal.defaultVatRate, null)
  assert.equal(personal.deductibleExpenses, 'none')
  assert.equal(personal.fiscalYearStartMonth, 1)
  assert.equal(personal.currency, 'EUR')
})

test('a VAT rate without a registration is refused, on creation as on correction', async () => {
  const user = await seedUser()
  await assert.rejects(
    createActivity(user, { name: 'Conseil', kind: 'business', defaultVatRate: 20 }),
    (e: DomainError) => e.code === 'vat_rate_needs_registration',
  )

  const activity = await createActivity(user, { name: 'Conseil', kind: 'business' })
  await assert.rejects(
    editActivity(user, activity.id, { defaultVatRate: 20 }),
    (e: DomainError) => e.code === 'vat_rate_needs_registration',
  )
  // Stated together, they pass; and the stored registration carries a later rate.
  await editActivity(user, activity.id, { vatRegistered: true, defaultVatRate: 20 })
  assert.equal(Number((await editActivity(user, activity.id, { defaultVatRate: 10 })).defaultVatRate), 10)
})

test('an activity carrying rules no longer changes regime', async () => {
  const user = await seedUser()
  const activity = await createActivity(user, { name: 'Conseil', kind: 'business', revenueBasis: 'cash' })

  // Nothing built on it yet: the regime is still being settled.
  assert.equal((await editActivity(user, activity.id, { revenueBasis: 'invoiced' })).revenueBasis, 'invoiced')

  await seedLevy(user, activity.id)
  await assert.rejects(
    editActivity(user, activity.id, { kind: 'personal' }),
    (e: DomainError) => e.code === 'activity_regime_fixed',
  )
  await assert.rejects(
    editActivity(user, activity.id, { revenueBasis: 'cash' }),
    (e: DomainError) => e.code === 'activity_regime_fixed',
  )
  // Everything else still corrects, and so does the same regime restated.
  assert.equal(
    (await editActivity(user, activity.id, { name: 'Conseil indépendant' })).name,
    'Conseil indépendant',
  )
  assert.equal((await editActivity(user, activity.id, { kind: 'business' })).kind, 'business')
})

test('an activity closes on a day, and reopens', async () => {
  const user = await seedUser()
  const activity = await createActivity(user, { name: 'Conseil', kind: 'business', startedOn: '2026-01-01' })

  assert.equal((await closeActivity(user, activity.id, '2026-12-31')).closedOn, '2026-12-31')
  await assert.rejects(
    closeActivity(user, activity.id, '2025-06-30'),
    (e: DomainError) => e.code === 'activity_closes_before_start',
  )
  assert.equal((await reopenActivity(user, activity.id)).closedOn, null)
})

test('the exceptions to a deductibility policy are stated as a whole', async () => {
  const user = await seedUser()
  const activity = await createActivity(user, {
    name: 'Conseil',
    kind: 'business',
    deductibleExpenses: 'all',
  })
  const meals = await createCategory(user, 'Repas')
  const travel = await createCategory(user, 'Déplacements')

  await setActivityCategoryExceptions(user, activity.id, [meals.id, travel.id])
  assert.deepEqual(
    (await listCategoryExceptions(user)).map((e) => e.categoryId).sort(),
    [meals.id, travel.id].sort(),
  )

  // The list replaces, it does not add: that is what a checklist says.
  await setActivityCategoryExceptions(user, activity.id, [meals.id])
  assert.deepEqual(
    (await listCategoryExceptions(user)).map((e) => e.categoryId),
    [meals.id],
  )
  await setActivityCategoryExceptions(user, activity.id, [])
  assert.equal((await listCategoryExceptions(user)).length, 0)

  const other = await seedUser('user-2')
  const theirs = await createCategory(other, 'Theirs')
  await assert.rejects(
    setActivityCategoryExceptions(user, activity.id, [theirs.id]),
    (e: DomainError) => e.code === 'category_not_found',
  )
})

test('an account belongs to a business activity, and only to one', async () => {
  const user = await seedUser()
  const business = await createActivity(user, { name: 'Conseil', kind: 'business' })
  const personal = await createActivity(user, { name: 'Location' })

  const account = await createAccount({
    userId: user,
    name: 'Pro',
    behavior: 'payment',
    activityId: business.id,
  })
  assert.equal(account.activityId, business.id)

  await assert.rejects(
    createAccount({ userId: user, name: 'Autre', behavior: 'payment', activityId: personal.id }),
    (e: DomainError) => e.code === 'activity_not_business',
  )
  await assert.rejects(
    editAccount(user, account.id, { activityId: personal.id }),
    (e: DomainError) => e.code === 'activity_not_business',
  )
  // An activity that owns accounts cannot become a personal sphere.
  await assert.rejects(
    editActivity(user, business.id, { kind: 'personal' }),
    (e: DomainError) => e.code === 'activity_has_accounts',
  )
  // Detaching it is what a correction says, and it frees the activity.
  assert.equal((await editAccount(user, account.id, { activityId: null })).activityId, null)
  assert.equal((await editActivity(user, business.id, { kind: 'personal' })).kind, 'personal')
})

test('a client carries what it does to an invoice', async () => {
  const user = await seedUser()
  const client = await createActor(user, {
    name: 'Client A',
    invoiceVatRate: 21,
    invoiceWithholdingRate: 15,
  })
  assert.equal(Number(client.invoiceVatRate), 21)
  assert.equal(Number(client.invoiceWithholdingRate), 15)

  const fixed = await editActor(user, client.id, { invoiceWithholdingRate: 7 })
  assert.equal(Number(fixed.invoiceWithholdingRate), 7)
  // Both clear, which is what "this client states none" means.
  const cleared = await editActor(user, client.id, { invoiceVatRate: null, invoiceWithholdingRate: null })
  assert.equal(cleared.invoiceVatRate, null)
  assert.equal(cleared.invoiceWithholdingRate, null)

  await assert.rejects(
    editActor(user, client.id, { invoiceVatRate: 120 }),
    (e: DomainError) => e.code === 'bad_rate',
  )
  // An actor declared without them states nothing, rather than zero.
  await createActor(user, { name: 'Commerçant' })
  const plain = (await listActors(user)).find((a) => a.name === 'Commerçant')!
  assert.equal(plain.invoiceVatRate, null)
})

test('scopes an activity to its user', async () => {
  const user = await seedUser()
  const other = await seedUser('user-2')
  const theirs = await createActivity(other, { name: 'Theirs', kind: 'business' })

  await assert.rejects(closeActivity(user, theirs.id), (e: DomainError) => e.code === 'activity_not_found')
  await assert.rejects(reopenActivity(user, theirs.id), (e: DomainError) => e.code === 'activity_not_found')
  await assert.rejects(
    setActivityCategoryExceptions(user, theirs.id, []),
    (e: DomainError) => e.code === 'activity_not_found',
  )
  await assert.rejects(
    createAccount({ userId: user, name: 'Pro', behavior: 'payment', activityId: theirs.id }),
    (e: DomainError) => e.code === 'activity_not_found',
  )
  assert.equal((await listActivities(user)).length, 0)
})
